"""Run either exported model using only the Python standard library."""
import argparse
import json
import math
from pathlib import Path
import sys

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from pumphawk_ml.inference import predict_portable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frequency', choices=['daily', 'weekly'])
    parser.add_argument('--features', type=Path, required=True,
                        help='JSON object with frequency, anchor_price and model features')
    args = parser.parse_args()
    try:
        bundle = json.loads((ML / 'artifacts' / args.frequency / 'model.json').read_text())
        features = json.loads(args.features.read_text())
        if not isinstance(features, dict):
            raise ValueError('Features must be a JSON object')
        anchor = features.get('anchor_price')
        if isinstance(anchor, bool) or not isinstance(anchor, (int, float)) or not math.isfinite(anchor) or anchor <= 0:
            raise ValueError('anchor_price must be a positive finite price in pence per litre')
        predictions = predict_portable(bundle, features, args.frequency)
        result = {
            'frequency': bundle['frequency'],
            'target': bundle['target'],
            'unit': bundle['unit'],
            'model_fingerprint': bundle['fingerprint'],
            'status': bundle['status'],
            'horizon_semantics': bundle['horizon_semantics'],
            'predictions': predictions,
        }
        print(json.dumps(result, indent=2, allow_nan=False))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
