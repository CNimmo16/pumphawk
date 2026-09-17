"""Inference for trusted local model artifacts; frequency is an enforced contract."""
import math


def predict(bundle, feature_rows, frequency):
    import pandas as pd

    if frequency != bundle['frequency']:
        raise ValueError('Model frequency mismatch; weekly training cannot produce daily forecasts')
    frame = pd.DataFrame(feature_rows)
    if 'frequency' not in frame or not (frame.frequency == frequency).all():
        raise ValueError('Feature rows must declare their matching observation frequency')
    predictions = []
    for horizon, model in bundle['models'].items():
        missing = set(model['features']) - set(frame)
        if missing:
            raise ValueError(f'Missing features: {sorted(missing)}')
        delta = model['pipeline'].predict(frame[model['features']]) * model['blend']
        for index, value in enumerate(delta):
            predictions.append({'row': index, 'frequency': frequency, 'observation_horizon_days': int(horizon),
                                'predicted_change_ppl': float(value),
                                'predicted_price_ppl': float(frame.iloc[index].anchor_price + value),
                                'empirical_interval_radius_ppl': model['interval_radius']})
    return predictions


def predict_portable(bundle, features, frequency):
    """Mirror a fitted sklearn linear pipeline without sklearn or pickle."""
    if frequency != bundle['frequency'] or features.get('frequency') != frequency:
        raise ValueError('Model frequency mismatch')
    results = {}
    for horizon, model in bundle['models'].items():
        raw = [features[name] for name in model['features']]
        missing = [v is None or not math.isfinite(float(v)) for v in raw]
        values = [model['imputation_values'][i] if missing[i] else float(v) for i, v in enumerate(raw)]
        values.extend(float(missing[i]) for i in model['missing_indicator_indices'])
        scaled = [(value - mean) / scale for value, mean, scale in zip(values, model['scaler_mean'], model['scaler_scale'], strict=True)]
        delta = (sum(c * value for c, value in zip(model['coefficients'], scaled, strict=True)) + model['intercept']) * model['blend']
        results[horizon] = {'change_ppl': delta, 'price_ppl': features['anchor_price'] + delta}
    return results
