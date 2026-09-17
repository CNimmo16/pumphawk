"""Fit frozen specifications on pre-calibration rows only, with portable metadata."""
from __future__ import annotations

import hashlib
import json
import pickle
from pathlib import Path

import numpy as np

from pumphawk_ml.framework import Candidate, SPLITS, load_frame, make_estimator, training_rows

OUT = Path(__file__).resolve().parent


def values(array):
    return [float(v) if np.isfinite(v) else None for v in array]


def main():
    choices = json.loads((OUT / 'selected.json').read_text())
    frame = load_frame('weekly')
    cutoff = SPLITS['weekly']['calibration_start']
    directory = OUT / 'fitted'
    directory.mkdir(exist_ok=True)
    bundle = {'frequency': 'weekly', 'fitted_before': cutoff, 'models': {}}
    for h in (7, 14):
        candidate = Candidate(**choices[str(h)])
        train = training_rows(frame, cutoff, h, candidate.train_days)
        model = make_estimator(candidate)
        model.fit(train[candidate.features], train.target_delta)
        bundle['models'][str(h)] = {'features': candidate.features, 'pipeline': model,
                                    'blend': candidate.blend, 'interval_radius': None}
        imputer, scaler, estimator = [step for _, step in model.steps]
        report = {
            'frequency': 'weekly', 'horizon': h, 'candidate': choices[str(h)], 'fitted_before': cutoff,
            'train_rows': len(train), 'first_origin': train.origin.min().isoformat(),
            'last_origin': train.origin.max().isoformat(),
            'last_target_available_at': train.target_available_at.max().isoformat(),
            'training_input_sha256': hashlib.sha256(train[['origin', 'target_available_at', 'target_delta'] + candidate.features].to_csv(index=False).encode()).hexdigest(),
            'input_columns': candidate.features,
            'transformed_columns': imputer.get_feature_names_out(candidate.features).tolist(),
            'imputer_medians': values(imputer.statistics_),
            'missing_indicator_indices': imputer.indicator_.features_.tolist(),
            'scaler_mean': values(scaler.mean_), 'scaler_scale': values(scaler.scale_),
            'prediction_blend': candidate.blend,
            'fit_scope': 'Pre-calibration only; no Jan2026 onward labels or test results accessed.',
        }
        if hasattr(estimator, 'coef_'):
            report.update(standardized_coefficients=values(estimator.coef_), intercept=float(estimator.intercept_),
                          inference='Impute listed inputs; append missing indicators; subtract scaler_mean and divide by scaler_scale; dot standardized_coefficients plus intercept; multiply prediction_blend. Output is pence/litre change from latest released reference observation.')
        (directory / f'h{h}.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
        print(json.dumps({'horizon': h, 'candidate': candidate.name, 'train_rows': len(train), 'cutoff': cutoff}))
    (directory / 'precalibration.pkl').write_bytes(pickle.dumps(bundle))


if __name__ == '__main__':
    main()
