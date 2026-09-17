"""Reproduce validation-only weekly model experiments; sealed rows stay excluded."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

import pumphawk_ml.framework as framework
from pumphawk_ml.framework import (
    Candidate, SPLITS, baseline_suite, cross_validate, load_frame, metrics, score,
)

OUT = Path(__file__).resolve().parent
PUMP = ['x_pump_change_7', 'x_pump_change_14', 'x_pump_change_28']
REFINED = ['x_b7h_change_3', 'x_b7h_change_7', 'x_b7h_change_14', 'x_b7h_change_28']
CRUDE = ['x_bz_change_7', 'x_bz_change_14', 'x_bz_change_28']


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def data_status():
    path = framework.DATA / 'DATA_STATUS.json'
    return json.loads(path.read_text()) if path.exists() else {'stage': 'unspecified'}


def candidates():
    return {
        'pump_ridge': Candidate('pump_ridge', features=PUMP, params={'alpha': 10}),
        'refined_ridge': Candidate('refined_ridge', features=PUMP + REFINED, params={'alpha': 10}),
        'market_ridge': Candidate('market_ridge', features=PUMP + REFINED + CRUDE + ['x_fx_change_7'], params={'alpha': 10}),
        'pump_huber': Candidate('pump_huber', kind='huber', features=PUMP,
                                params={'epsilon': 1.35, 'alpha': .1, 'max_iter': 2000}),
        'pump_ridge_3y': Candidate('pump_ridge_3y', features=PUMP, params={'alpha': 10}, train_days=1095),
        'pump_single_ridge': Candidate('pump_single_ridge', features=['x_pump_change_7'],
                                      params={'alpha': 10, 'fit_intercept': False}),
        'refined_huber': Candidate('refined_huber', kind='huber', features=PUMP + REFINED,
                                   params={'epsilon': 1.35, 'alpha': .1, 'max_iter': 2000}),
    }


def fold_metrics(predictions):
    return {
        f'{fold[:4]}_h{h}': metrics(g.actual_delta, g.predicted_delta)
        for (fold, h), g in predictions.groupby(['fold', 'horizon'])
    }


def save_result(name, summary, predictions, specification=None):
    directory = OUT / 'results' / name
    directory.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(directory / 'predictions.csv', index=False)
    result = {'name': name, 'mean_horizon_mae': score(summary), 'horizons': summary,
              'folds': fold_metrics(predictions),
              'data_status': data_status(),
              'runtime': {'python': platform.python_version(), 'numpy': np.__version__,
                          'pandas': pd.__version__, 'scikit_learn': sklearn.__version__,
                          'framework_sha256': hashlib.sha256(Path(framework.__file__).read_bytes()).hexdigest()}}
    if specification is not None:
        result['candidate'] = asdict(specification)
    dump(directory / 'summary.json', result)
    print(json.dumps({'name': name, 'mean_mae': score(summary),
                      'horizon_mae': {h: v['mae'] for h, v in summary.items()}}), flush=True)


def audit_validation(frame):
    cutoff = pd.Timestamp(SPLITS['weekly']['calibration_start'], tz='UTC')
    assert (frame.origin < cutoff).all() and (frame.target_available_at < cutoff).all()
    features = [c for c in frame if c.startswith('x_')]
    report = {
        'protocol': SPLITS['weekly'], 'rows': len(frame), 'origins': frame.origin.nunique(),
        'first_origin': frame.origin.min().isoformat(), 'last_origin': frame.origin.max().isoformat(),
        'last_target_available_at': frame.target_available_at.max().isoformat(),
        'yearly_rows_per_horizon': {f'{y}_h{h}': len(g) for (y, h), g in frame.groupby([frame.origin.dt.year, 'horizon'])},
        'feature_missing_by_year': {str(y): {c: float(g[c].isna().mean()) for c in features}
                                    for y, g in frame.groupby(frame.origin.dt.year)},
    }
    dump(OUT / 'validation-data-audit.json', report)


def compare():
    rows = []
    for path in sorted((OUT / 'results').glob('*/summary.json')):
        result = json.loads(path.read_text())
        for h, values in result['horizons'].items():
            rows.append({'candidate': result['name'], 'horizon': int(h), **values})
    table = pd.DataFrame(rows)
    table.to_csv(OUT / 'comparison.csv', index=False)
    print(table[['candidate', 'horizon', 'mae', 'rmse', 'bias', 'p90_abs_error', 'decision_regret_ppl']].to_string(index=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--candidate', action='append', choices=list(candidates()))
    parser.add_argument('--spec', type=Path, action='append', help='Saved Candidate JSON specification')
    parser.add_argument('--compare', action='store_true')
    args = parser.parse_args()
    if args.baseline or args.candidate or args.spec:
        frame = load_frame('weekly')
        audit_validation(frame)
        if args.baseline:
            for name, (summary, predictions) in baseline_suite('weekly', frame=frame).items():
                save_result('baseline_' + name, summary, predictions)
        selected = [candidates()[name] for name in args.candidate or []]
        selected.extend(Candidate(**json.loads(path.read_text())) for path in args.spec or [])
        for candidate in selected:
            uses_market = any(f.startswith(('x_b7h', 'x_bz', 'x_fx', 'x_crack')) for f in candidate.features)
            if uses_market and data_status().get('market_ready') is False:
                raise RuntimeError('Shared market features are not ready; only retail-only candidates are permitted.')
            summary, predictions = cross_validate('weekly', candidate=candidate, frame=frame)
            save_result(candidate.name, summary, predictions, candidate)
    if args.compare:
        compare()


if __name__ == '__main__':
    main()
