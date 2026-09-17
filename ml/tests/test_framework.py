import numpy as np
import pandas as pd
from pumphawk_ml.framework import baseline, metrics, training_rows
from pumphawk_ml.inference import predict, predict_portable


def test_training_purges_unavailable_labels_even_for_old_origins():
    df = pd.DataFrame({'origin': pd.to_datetime(['2026-01-01', '2026-01-02'], utc=True),
                       'target_available_at': pd.to_datetime(['2026-01-08', '2026-01-16'], utc=True), 'horizon': [14, 14]})
    assert len(training_rows(df, '2026-01-10', 14)) == 1


def test_fuel_decision_regret_penalises_wrong_direction():
    assert metrics([2, -3], [1, -1])['decision_regret_ppl'] == 0
    assert metrics([2, -3], [-1, 1])['decision_regret_ppl'] == 2.5


def test_weekly_data_cannot_enter_daily_heuristic():
    import pytest
    frame = pd.DataFrame({'frequency': ['weekly'], 'horizon': [7], 'x_pump_slope_short': [0], 'x_pump_slope_long': [0]})
    with pytest.raises(ValueError):
        baseline(frame, 'current_heuristic')


def test_inference_rejects_cross_frequency_forecasts():
    import pytest
    with pytest.raises(ValueError, match='frequency mismatch'):
        predict({'frequency': 'weekly'}, [{'frequency': 'daily'}], 'daily')


def test_bootstrap_is_invariant_to_horizon_row_order():
    from pumphawk_ml.framework import block_bootstrap_skill
    frame = pd.DataFrame({'origin': list(pd.date_range('2020-01-01', periods=8).repeat(2)),
                          'horizon': [7, 14] * 8, 'actual_delta': np.arange(16), 'predicted_delta': np.arange(16) + .5})
    base = frame.copy()
    base['predicted_delta'] += 1
    first = block_bootstrap_skill(frame, base, 2, 100)
    shuffled = block_bootstrap_skill(frame.sample(frac=1, random_state=3), base, 2, 100)
    assert first == shuffled


def test_production_style_heuristic_handles_opposing_market_signals():
    frame = pd.DataFrame({'frequency': ['daily'], 'horizon': [1], 'x_pump_slope_short': [0],
                          'x_pump_slope_long': [0], 'x_pump_change_7': [0],
                          'x_b7h_change_7': [2], 'x_bz_change_7': [-8]})
    # The rise begins immediately, while the negative Brent move has a two-day lag.
    assert baseline(frame, 'current_heuristic')[0] > 0


def test_portable_linear_prediction_preserves_imputation_indicators_and_scaling():
    bundle = {'frequency': 'daily', 'models': {'1': {'features': ['a', 'b'],
              'imputation_values': [2, 4], 'missing_indicator_indices': [0],
              'scaler_mean': [2, 4, 0], 'scaler_scale': [1, 2, 1],
              'coefficients': [1, .5, 10], 'intercept': 1, 'blend': .5}}}
    result = predict_portable(bundle, {'frequency':'daily','a':None,'b':6,'anchor_price':150}, 'daily')
    assert result['1']['change_ppl'] == 5.75
    assert result['1']['price_ppl'] == 155.75
