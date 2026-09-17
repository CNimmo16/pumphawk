"""Parent-only: open sealed periods after a candidate specification is frozen.

Repeated execution with the identical selection/data is reproducible. A changed
selection after opening the test is rejected to prevent silent test-set tuning.
"""
import argparse
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from pumphawk_ml.framework import (Candidate, DATA, SPLITS, baseline, baseline_suite,
                                  block_bootstrap_skill, load_frame, metrics,
                                  predict_candidate, training_rows)

ML = Path(__file__).resolve().parents[1]
ARTIFACTS = DATA.parent.parent / 'model-artifacts'


def evaluate(mode):
    directory = ML / 'experiments' / mode
    selected_path = directory / 'selected.json'
    selected = json.loads(selected_path.read_text())
    fingerprint = hashlib.sha256(selected_path.read_bytes() + (DATA / f'{mode}-supervised.csv').read_bytes()).hexdigest()
    marker = directory / 'sealed-test-opened.json'
    if marker.exists() and json.loads(marker.read_text())['fingerprint'] != fingerprint:
        raise RuntimeError('Selection or data changed after test opened. A new independent test is required.')
    if not marker.exists():
        marker.write_text(json.dumps({'fingerprint': fingerprint, 'mode': mode,
                                       'opened_at': pd.Timestamp.now(tz='UTC').isoformat()}, indent=2))
    frame = load_frame(mode, include_sealed=True)
    validation_baselines = baseline_suite(mode)
    calibration_start = pd.Timestamp(SPLITS[mode]['calibration_start'], tz='UTC')
    test_start = pd.Timestamp(SPLITS[mode]['test_start'], tz='UTC')
    reports, predictions, fitted = {}, [], {}
    for horizon in SPLITS[mode]['horizons']:
        candidate = Candidate(**selected[str(horizon)])
        train_calibration = training_rows(frame, calibration_start, horizon, candidate.train_days)
        calibration = frame[(frame.horizon == horizon) & (frame.origin >= calibration_start)
                            & (frame.origin < test_start) & (frame.target_available_at < test_start)]
        if len(calibration):
            p, _ = predict_candidate(candidate, train_calibration, calibration)
            residuals = abs(calibration.target_delta.to_numpy() - p)
            level = min(1.0, np.ceil((len(residuals) + 1) * .9) / len(residuals))
            interval_radius = float(np.quantile(residuals, level, method='higher'))
        else:
            interval_radius = None
        train = training_rows(frame, test_start, horizon, candidate.train_days)
        test = frame[(frame.horizon == horizon) & (frame.origin >= test_start)].copy()
        if test.empty:
            raise RuntimeError(f'No test labels at horizon {horizon}')
        prediction, estimator = predict_candidate(candidate, train, test)
        baseline_name = min(validation_baselines, key=lambda name: validation_baselines[name][0][str(horizon)]['mae'])
        reference = baseline(test, baseline_name)
        result = test[['origin', 'target_date', 'horizon', 'anchor_price', 'target_delta']].rename(columns={'target_delta': 'actual_delta'})
        result['predicted_delta'] = prediction
        result['baseline_delta'] = reference
        result['baseline_name'] = baseline_name
        result['predicted_price'] = result.anchor_price + prediction
        result['actual_price'] = result.anchor_price + result.actual_delta
        result['interval_radius'] = interval_radius
        result['interval_lower'] = result.predicted_price - (interval_radius if interval_radius is not None else np.nan)
        result['interval_upper'] = result.predicted_price + (interval_radius if interval_radius is not None else np.nan)
        model_metrics, baseline_metrics = metrics(result.actual_delta, prediction), metrics(result.actual_delta, reference)
        coverage = float((abs(result.actual_delta - prediction) <= interval_radius).mean()) if interval_radius is not None else None
        compared = result.copy()
        compared['predicted_delta'] = reference
        reports[str(horizon)] = {'model': model_metrics, 'baseline': baseline_metrics, 'baseline_name': baseline_name,
                                'mae_skill': 1 - model_metrics['mae'] / baseline_metrics['mae'],
                                'train_count': len(train), 'calibration_count': len(calibration),
                                'interval_nominal': .9, 'interval_radius': interval_radius, 'interval_coverage': coverage,
                                'paired_skill_ci': block_bootstrap_skill(result, compared, max(2, horizon) if mode == 'daily' else 4)}
        if mode == 'daily':
            reports[str(horizon)]['fixed_cohort_transfer'] = metrics(test.fixed_cohort_target_delta, prediction)
            reports[str(horizon)]['fresh14_transfer'] = metrics(test.fresh14_target_delta, prediction)
        predictions.append(result)
        fitted[str(horizon)] = {'pipeline': estimator, 'features': candidate.features, 'blend': candidate.blend, 'interval_radius': interval_radius}
    keys = ['1', '3', '7', '14'] if mode == 'daily' else ['7', '14']
    thresholds = {'1': 1.0, '3': 1.5, '7': 2.0, '14': 3.0}
    model_mae = float(np.mean([reports[h]['model']['mae'] for h in keys]))
    baseline_mae = float(np.mean([reports[h]['baseline']['mae'] for h in keys]))
    gates = {'mae_skill_at_least_10_percent': model_mae <= .9 * baseline_mae,
             'absolute_mae_targets': all(reports[h]['model']['mae'] <= thresholds[h] for h in keys),
             'no_key_horizon_over_5_percent_worse': all(reports[h]['model']['mae'] <= 1.05 * reports[h]['baseline']['mae'] for h in keys)}
    combined = pd.concat(predictions, ignore_index=True)
    combined.to_csv(directory / 'test-predictions.csv', index=False)
    key_predictions = combined[combined.horizon.isin([int(h) for h in keys])].copy()
    key_baseline = key_predictions.copy()
    key_baseline['predicted_delta'] = key_baseline.baseline_delta
    summary = {'mode': mode, 'fingerprint': fingerprint, 'test_start': str(test_start), 'horizons': reports,
               'key_horizon_mean_mae': model_mae, 'key_horizon_baseline_mae': baseline_mae,
               'key_horizon_mae_skill': 1 - model_mae / baseline_mae, 'gates': gates,
               'passes_test_numerical_gates': all(gates.values()),
               'joint_skill_ci': block_bootstrap_skill(key_predictions, key_baseline, 14 if mode == 'daily' else 4),
               'interval_caveat': 'Empirical pre-test residual bands, then coefficients refit at test start. Time dependence and regime shifts invalidate exchangeability; nominal coverage is not guaranteed.',
               'deployment_status': 'research_only_pending_review'}
    (directory / 'test-report.json').write_text(json.dumps(summary, indent=2))
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump({'frequency': mode, 'models': fitted, 'fitted_before': str(test_start), 'fingerprint': fingerprint}, ARTIFACTS / f'{mode}-evaluation.joblib')
    print(json.dumps({k:v for k,v in summary.items() if k != 'horizons'}, indent=2))
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['daily', 'weekly'])
    evaluate(parser.parse_args().mode)
