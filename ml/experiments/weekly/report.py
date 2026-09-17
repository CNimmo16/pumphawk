"""Summarize frozen validation choices; reads local experiment outputs only."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pumphawk_ml.framework import metrics

OUT = Path(__file__).resolve().parent


def read_predictions(name):
    return pd.read_csv(OUT / 'results' / name / 'predictions.csv', parse_dates=['origin', 'target_date'])


def block_uncertainty(joined, block_weeks=8, repeats=4000):
    """Paired, circular blocks of origins, separately within validation years.

    Both horizons use the same sampled origins. The score is the equal-weight
    mean of the two horizon MAEs. This conditions on the observed regime mix;
    it does not establish generalization to unobserved shocks or future vintages.
    """
    joined = joined.copy()
    joined['gain'] = abs(joined.actual_delta - joined.baseline_delta) - abs(joined.actual_delta - joined.predicted_delta)
    matrices = [g.pivot(index='origin', columns='horizon', values='gain').sort_index().to_numpy()
                for _, g in joined.groupby('fold')]
    rng = np.random.default_rng(20260916)
    boot = []
    for _ in range(repeats):
        sampled = []
        for values in matrices:
            starts = rng.integers(0, len(values), int(np.ceil(len(values) / block_weeks)))
            idx = np.concatenate([(s + np.arange(block_weeks)) % len(values) for s in starts])[:len(values)]
            sampled.append(values[idx])
        boot.append(float(np.nanmean(np.nanmean(np.concatenate(sampled), axis=0))))
    actual = joined.groupby('horizon').gain.mean().mean()
    return {'mean_mae_reduction_ppl': float(actual), 'ci95_ppl': np.quantile(boot, [.025, .975]).tolist(),
            'fraction_reduction_positive': float(np.mean(np.asarray(boot) > 0)),
            'block_origins': block_weeks, 'repeats': repeats,
            'method': 'Paired circular chronological-origin blocks stratified by year; same origins across horizons; equal horizon score.'}


def main():
    choices = json.loads((OUT / 'selected.json').read_text())
    selection, baseline_selection, comparisons = [], {}, []
    for h in (7, 14):
        predictions = read_predictions(choices[str(h)]['name'])
        predictions = predictions[predictions.horizon == h].copy()
        selection.append(predictions)
        baselines = []
        for path in sorted((OUT / 'results').glob('baseline_*/summary.json')):
            summary = json.loads(path.read_text())
            baselines.append((summary['horizons'][str(h)]['mae'], summary['name']))
        _, baseline_name = min(baselines)
        baseline_selection[str(h)] = baseline_name
        reference = read_predictions(baseline_name)
        joined = predictions.merge(reference[['origin', 'horizon', 'predicted_delta']],
                                   on=['origin', 'horizon'], suffixes=('', '_reference'), validate='one_to_one')
        joined = joined.rename(columns={'predicted_delta_reference': 'baseline_delta'})
        comparisons.append(joined)
    predictions = pd.concat(selection).sort_values(['origin', 'horizon'])
    predictions.to_csv(OUT / 'selected-validation-predictions.csv', index=False)
    joined = pd.concat(comparisons).sort_values(['origin', 'horizon'])
    horizon_metrics, baseline_metrics, fold_metrics = {}, {}, {}
    for h, g in joined.groupby('horizon'):
        horizon_metrics[str(h)] = metrics(g.actual_delta, g.predicted_delta)
        baseline_metrics[str(h)] = metrics(g.actual_delta, g.baseline_delta)
    for (fold, h), g in joined.groupby(['fold', 'horizon']):
        model = metrics(g.actual_delta, g.predicted_delta)
        baseline = metrics(g.actual_delta, g.baseline_delta)
        fold_metrics[f'{fold[:4]}_h{h}'] = {'model': model, 'baseline': baseline,
                                         'relative_mae_reduction': 1 - model['mae'] / baseline['mae']}
    mean_model = float(np.mean([v['mae'] for v in horizon_metrics.values()]))
    mean_baseline = float(np.mean([v['mae'] for v in baseline_metrics.values()]))
    gates = {
        'mean_mae_improves_10_percent': mean_model <= .9 * mean_baseline,
        'next_observation_at_most_2_ppl': horizon_metrics['7']['mae'] <= 2,
        'second_observation_at_most_3_ppl': horizon_metrics['14']['mae'] <= 3,
        'neither_horizon_over_5_percent_worse': all(horizon_metrics[h]['mae'] <= 1.05 * baseline_metrics[h]['mae'] for h in ('7', '14')),
    }
    report = {
        'selection': choices, 'strongest_baseline_by_horizon': baseline_selection,
        'model': horizon_metrics, 'baseline': baseline_metrics,
        'mean_horizon_mae': mean_model, 'mean_baseline_mae': mean_baseline,
        'relative_mean_mae_reduction': 1 - mean_model / mean_baseline,
        'provisional_validation_gates': gates, 'all_validation_gates_pass': all(gates.values()),
        'folds': fold_metrics,
        'blocked_uncertainty': {str(b): block_uncertainty(joined, b) for b in (4, 8, 13)},
        'calibration_and_test': 'Still sealed; these results support selection only.',
    }
    (OUT / 'selected-validation-report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('selection', 'folds')}, indent=2))


if __name__ == '__main__':
    main()
