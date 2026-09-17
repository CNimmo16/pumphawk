from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, HuberRegressor, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

_ROOT = next((p for p in Path(__file__).resolve().parents if (p / 'PRICES.md').exists()), Path.cwd())
DATA = Path(os.environ.get('PUMP_HAWK_DATA', str(_ROOT / '.local/model-data/processed')))
SPLITS = {
    'daily': {'folds': [('2026-05-15', '2026-06-05'), ('2026-06-05', '2026-06-26'), ('2026-06-26', '2026-07-20')],
              'calibration_start': '2026-07-20', 'test_start': '2026-08-15', 'horizons': list(range(1, 15))},
    'weekly': {'folds': [(f'{y}-01-01', f'{y+1}-01-01') for y in range(2020, 2026)],
               'calibration_start': '2026-01-01', 'test_start': '2026-04-01', 'horizons': [7, 14]},
}


@dataclass
class Candidate:
    name: str
    kind: str = 'ridge'
    features: list[str] = field(default_factory=list)
    params: dict = field(default_factory=dict)
    train_days: int | None = None
    blend: float = 1.0

    def save(self, path):
        Path(path).write_text(json.dumps(asdict(self), indent=2) + '\n')


def load_frame(mode, *, include_sealed=False):
    frame = pd.read_csv(DATA / f'{mode}-supervised.csv')
    for c in ('origin', 'observation_date', 'target_date', 'target_available_at'):
        frame[c] = pd.to_datetime(frame[c], utc=True)
    if not include_sealed:
        cutoff = pd.Timestamp(SPLITS[mode]['calibration_start'], tz='UTC')
        # Even a validation label must precede the sealed calibration period.
        frame = frame[(frame.origin < cutoff) & (frame.target_available_at < cutoff)]
    return frame.reset_index(drop=True)


def feature_columns(frame):
    return [c for c in frame if c.startswith('x_')]


def make_estimator(candidate):
    choices = {'ridge': Ridge, 'elastic': ElasticNet, 'huber': HuberRegressor,
               'hist': HistGradientBoostingRegressor, 'extra': ExtraTreesRegressor,
               'forest': RandomForestRegressor}
    params = dict(candidate.params)
    if candidate.kind in ('hist', 'extra', 'forest', 'elastic'):
        params.setdefault('random_state', 42)
    if candidate.kind in ('extra', 'forest'):
        params.setdefault('n_jobs', 1)
    model = choices[candidate.kind](**params)
    return make_pipeline(SimpleImputer(strategy='median', add_indicator=True, keep_empty_features=True),
                         StandardScaler(), model)


def training_rows(frame, cutoff, horizon, train_days=None):
    cutoff = pd.Timestamp(cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize('UTC')
    result = frame[(frame.horizon == horizon) & (frame.origin < cutoff) & (frame.target_available_at < cutoff)]
    if train_days:
        result = result[result.origin >= cutoff - pd.Timedelta(days=train_days)]
    return result


def baseline(frame, kind):
    h = frame.horizon.to_numpy()
    if kind == 'persistence':
        return np.zeros(len(frame))
    short = frame.x_pump_slope_short.fillna(0).to_numpy()
    long = frame.x_pump_slope_long.fillna(0).to_numpy()
    if kind == 'momentum_short':
        return np.clip(short, -3, 3) * h
    if kind == 'momentum_long':
        return np.clip(long, -3, 3) * h
    if kind == 'damped_momentum':
        return np.clip(short, -3, 3) * 5 * (1 - np.exp(-h / 5))
    if kind == 'current_heuristic':
        if 'daily' not in set(frame.frequency):
            raise ValueError('Daily heuristic cannot be applied to weekly labels')
        pump = baseline(frame, 'momentum_short')
        observed = frame.x_pump_change_7.to_numpy()
        b7h = frame.x_b7h_change_7.to_numpy()
        brent = frame.x_bz_change_7.to_numpy()
        both = np.isfinite(b7h) & np.isfinite(brent)
        upstream = np.zeros(len(frame))
        for signal, share in [(b7h, .8), (brent, .2)]:
            pending = np.clip(1.2 * signal - observed, -20, 20)
            pace = np.where(pending >= 0, 1 - np.exp(-h / 2), np.clip((h - 2) / 12, 0, 1))
            upstream += np.nan_to_num(pending * pace) * np.where(both, share, 1.0)
        weight = .9 * np.exp(-(h - 1) / 6)
        return weight * pump + (1 - weight) * upstream
    raise ValueError(kind)


def metrics(truth, prediction):
    a, p = np.asarray(truth, dtype=float), np.asarray(prediction, dtype=float)
    error = p - a
    moving = abs(a) >= .5
    action = np.where(a > .5, 1, np.where(a < -.5, -1, 0))
    predicted_action = np.where(p > .5, 1, np.where(p < -.5, -1, 0))
    # Idealised binary buy-now versus wait-to-horizon decision; not a tank simulation.
    regret = np.where(p >= 0, np.maximum(-a, 0), np.maximum(a, 0))
    return {'n': len(a), 'mae': float(np.mean(abs(error))), 'rmse': float(np.sqrt(np.mean(error ** 2))),
            'bias': float(np.mean(error)), 'p90_abs_error': float(np.quantile(abs(error), .9)),
            'direction_accuracy_moving': float(np.mean(np.sign(a[moving]) == np.sign(p[moving]))) if moving.any() else None,
            'action_accuracy': float(np.mean(action == predicted_action)), 'decision_regret_ppl': float(np.mean(regret))}


def summarize(predictions):
    return {str(h): metrics(g.actual_delta, g.predicted_delta) for h, g in predictions.groupby('horizon')}


def predict_candidate(candidate, train, evaluation):
    estimator = make_estimator(candidate)
    estimator.fit(train[candidate.features], train.target_delta)
    delta = estimator.predict(evaluation[candidate.features]) * candidate.blend
    return delta, estimator


def cross_validate(mode, candidate=None, baseline_name=None, frame=None):
    if (candidate is None) == (baseline_name is None):
        raise ValueError('Specify exactly one candidate or baseline')
    frame = load_frame(mode) if frame is None else frame
    rows = []
    for start, end in SPLITS[mode]['folds']:
        start, end = pd.Timestamp(start, tz='UTC'), pd.Timestamp(end, tz='UTC')
        for h in SPLITS[mode]['horizons']:
            evaluation = frame[(frame.horizon == h) & (frame.origin >= start) & (frame.origin < end)]
            train = training_rows(frame, start, h, candidate.train_days if candidate else None)
            if evaluation.empty or len(train) < 25:
                continue
            if candidate:
                predicted, _ = predict_candidate(candidate, train, evaluation)
            else:
                predicted = baseline(evaluation, baseline_name)
            result = evaluation[['origin', 'target_date', 'horizon', 'target_delta', 'anchor_price']].copy()
            result = result.rename(columns={'target_delta': 'actual_delta'})
            result['predicted_delta'] = predicted
            result['fold'] = str(start.date())
            result['train_count'] = len(train)
            rows.append(result)
    if not rows:
        raise ValueError('No eligible evaluation rows')
    predictions = pd.concat(rows, ignore_index=True)
    return summarize(predictions), predictions


def score(summary, horizons=None):
    values = [v['mae'] for h, v in summary.items() if horizons is None or int(h) in horizons]
    return float(np.mean(values)) if values else float('inf')


def baseline_suite(mode, frame=None):
    kinds = ['persistence', 'momentum_short', 'momentum_long', 'damped_momentum']
    if mode == 'daily':
        kinds.append('current_heuristic')
    return {name: cross_validate(mode, baseline_name=name, frame=frame) for name in kinds}


def block_bootstrap_skill(predictions, reference, block_size, repeats=2000):
    joined = predictions.merge(reference, on=['origin', 'horizon'], suffixes=('', '_baseline'))
    diffs = abs(joined.actual_delta - joined.predicted_delta_baseline) - abs(joined.actual_delta - joined.predicted_delta)
    # Preserve the correlation across horizons at the same forecast origin, and
    # temporal dependence across overlapping forecast windows.
    joined['improvement'] = diffs
    values = joined.pivot(index='origin', columns='horizon', values='improvement').sort_index().to_numpy()
    rng = np.random.default_rng(42)
    means = []
    for _ in range(repeats):
        starts = rng.integers(0, len(values), int(np.ceil(len(values) / block_size)))
        sample = np.concatenate([values[(s + np.arange(block_size)) % len(values)] for s in starts])[:len(values)]
        means.append(float(np.nanmean(np.nanmean(sample, axis=0))))
    return {'mean_mae_reduction': float(np.nanmean(np.nanmean(values, axis=0))), 'ci95': np.quantile(means, [.025, .975]).tolist(), 'block_size': block_size}
