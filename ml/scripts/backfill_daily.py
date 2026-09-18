"""Append genuine daily snapshots from a pinned FuelCosts export, using training's aggregation.

Download stations.csv and price_history.csv from the same Hugging Face revision
into an ignored directory first. This command never connects to a database,
changes existing observations, or modifies fitted models/training datasets.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

from scripts.prepare import ROOT, daily_prices


def append_snapshots(history, snapshots, provenance):
    last = max(p['date'] for p in history['prices'] if p['frequency'] == 'daily')
    additions = [dict(frequency='daily', date=row.date, availableAt=row.available_at,
                      pricePence=row.price, stationCount=int(row.station_count),
                      source='fuelcosts-archive')
                 for row in snapshots.itertuples() if row.date > last]
    if additions:
        history['prices'].extend(additions)
        history.setdefault('backfills', []).append({**provenance,
                                                  'firstDate': additions[0]['date'],
                                                  'lastDate': additions[-1]['date'],
                                                  'observations': len(additions)})
    return additions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--archive-dir', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        parser.error('revision must be a pinned 40-character Hugging Face commit')
    directory = args.archive_dir.resolve()
    hashes = {name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
              for name in ('stations.csv', 'price_history.csv')}
    # Separate output directory keeps the frozen research inputs untouched.
    snapshots = daily_prices(source=directory, destination=directory)
    target = ROOT / 'services/api/data/model-history.json'
    history = json.loads(target.read_text())
    additions = append_snapshots(history, snapshots, {
        'revision': args.revision,
        'url': f'https://huggingface.co/datasets/jamesb7/fuel-prices-uk/tree/{args.revision}',
        'sha256': hashes,
        'method': 'Training aggregation: equal-station E10; max(recorded, source) strictly before 08:00 UTC; last partial London day excluded.',
    })
    if additions:
        target.write_text(json.dumps(history, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'appended': additions, 'existingObservationsPreserved': True}))


if __name__ == '__main__':
    main()
