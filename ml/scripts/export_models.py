"""Export fitted linear pipelines as portable JSON, suitable for later Workers use."""
import argparse
import json
from pathlib import Path

import joblib

from pumphawk_ml.framework import DATA


def export(mode):
    path = DATA.parent.parent / 'model-artifacts' / f'{mode}-evaluation.joblib'
    bundle = joblib.load(path)  # Only load trusted artifacts produced by this repo.
    ml = Path(__file__).resolve().parents[1]
    test = json.loads((ml / 'experiments' / mode / 'test-report.json').read_text())
    result = {'schema_version': 1, 'frequency': mode, 'unit': 'pence_per_litre',
              'status': 'research_only', 'fitted_before': bundle['fitted_before'],
              'fingerprint': bundle['fingerprint'], 'passes_test_point_accuracy_gates': test['passes_test_numerical_gates'],
              'target': 'official_sales_weighted_weekly_petrol' if mode == 'weekly' else 'equal_station_observed_E10_daily_proxy',
              'horizon_semantics': 'Next two weekly reference observations; conservative Thursday issuance' if mode == 'weekly' else 'Calendar days after the 08:00 UTC snapshot',
              'models': {}}
    for horizon, fitted in bundle['models'].items():
        pipeline = fitted['pipeline']
        imputer, scaler, linear = pipeline.steps[0][1], pipeline.steps[1][1], pipeline.steps[2][1]
        if not hasattr(linear, 'coef_'):
            raise ValueError('This exporter supports linear models only')
        result['models'][horizon] = {
            'features': fitted['features'], 'imputation_values': imputer.statistics_.tolist(),
            'missing_indicator_indices': imputer.indicator_.features_.tolist(),
            'scaler_mean': scaler.mean_.tolist(), 'scaler_scale': scaler.scale_.tolist(),
            'coefficients': linear.coef_.tolist(), 'intercept': float(linear.intercept_),
            'blend': fitted['blend'], 'empirical_interval_radius_ppl': fitted['interval_radius'],
            'interval_status': 'empirical_only_not_a_coverage_guarantee',
            'interval_nominal_coverage': .9, 'interval_test_coverage': test['horizons'][horizon]['interval_coverage'],
            'interval_below_nominal_in_test': test['horizons'][horizon]['interval_coverage'] < .9,
        }
    target = Path(__file__).resolve().parents[1] / 'artifacts' / mode
    target.mkdir(parents=True, exist_ok=True)
    (target / 'model.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(target / 'model.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['daily', 'weekly'])
    export(parser.parse_args().mode)
