from pathlib import Path

import pandas as pd

from scripts import prepare
from scripts.backfill_daily import append_snapshots


def test_archive_backfill_appends_without_revising_history_and_is_idempotent():
    existing = dict(frequency='daily', date='2026-09-16', pricePence=150,
                    source='fuel-finder-observed')
    history = {'prices': [existing.copy()]}
    snapshots = pd.DataFrame([
        dict(date='2026-09-16', available_at='2026-09-16T08:00:00+00:00',
             price=999, station_count=7000),
        dict(date='2026-09-17', available_at='2026-09-17T08:00:00+00:00',
             price=151, station_count=8000),
    ])
    added = append_snapshots(history, snapshots, {'revision': 'pinned-export'})
    assert history['prices'][0] == existing
    assert added == [dict(frequency='daily', date='2026-09-17',
                          availableAt='2026-09-17T08:00:00+00:00', pricePence=151,
                          stationCount=8000, source='fuelcosts-archive')]
    assert append_snapshots(history, snapshots, {'revision': 'pinned-export'}) == []
    assert len(history['backfills']) == 1


def test_daily_snapshots_respect_availability_stale_updates_and_first_seen(tmp_path, monkeypatch):
    source = tmp_path / '.local/fuelcosts'
    source.mkdir(parents=True)
    target = tmp_path / 'processed'
    target.mkdir()
    pd.DataFrame([{'node_id': n, 'latitude': 51.5, 'longitude': -.1,
                   'is_permanently_closed': False, 'is_temporarily_closed': False}
                  for n in ['a', 'b', 'c']]).to_csv(source / 'stations.csv', index=False)
    events = [
        (1, 'a', 140, '2026-02-07T21:00:00Z', '2026-02-07T20:00:00Z'),
        # Received before the Feb8 snapshot but not effective until 09:00.
        (2, 'a', 150, '2026-02-08T07:45:00Z', '2026-02-08T09:00:00Z'),
        # A late observation of an older source price must not overwrite150.
        (3, 'a', 130, '2026-02-08T10:00:00Z', '2026-02-07T22:00:00Z'),
        (4, 'b', 160, '2026-02-09T09:00:00Z', '2026-02-09T08:30:00Z'),
        # Last partial day excluded, never backfill c into earlier snapshots.
        (5, 'c', 180, '2026-02-11T00:01:00Z', '2026-02-10T12:00:00Z'),
    ]
    df = pd.DataFrame(events, columns=['id', 'node_id', 'price_pence', 'recorded_at', 'source_updated_at'])
    df['fuel_type'] = 'E10'
    df.to_csv(source / 'price_history.csv', index=False)
    monkeypatch.setattr(prepare, 'ROOT', tmp_path)
    monkeypatch.setattr(prepare, 'OUT', target)
    result = prepare.daily_prices()
    assert result.price.tolist() == [140, 150, 155]
    assert result.station_count.tolist() == [1, 1, 2]
    assert result.fixed_cohort_price.tolist() == [140, 150, 150]
    assert result.available_at.iloc[0] == '2026-02-08T08:00:00+00:00'


def test_market_replay_excludes_future_revisions_and_uses_same_contract_at_roll(tmp_path, monkeypatch):
    raw = tmp_path / 'raw'
    raw.mkdir()
    out = tmp_path / 'out'
    out.mkdir()
    fx = [{'TIME_PERIOD': d, 'CURRENCY': c, 'OBS_VALUE': v}
          for d in ['2016-01-01', '2016-01-02', '2016-01-03', '2016-01-04']
          for c,v in [('GBP', .8), ('USD', 1.2)]]
    pd.DataFrame(fx).to_csv(raw / 'ecb-fx.csv', index=False)
    events = []
    for contract, price, day in [('A',100,2), ('B',200,2), ('A',110,3), ('B',210,3), ('B',220,4)]:
        events.append(dict(product='b7h', contract=contract, reference=pd.Timestamp(f'2016-01-{day:02d}',tz='UTC'),
                           price=price, available_at=pd.Timestamp(f'2016-01-{day:02d} 20:00',tz='UTC'),
                           expires_at=pd.Timestamp('2016-01-04 12:00' if contract=='A' else '2016-02-04 12:00',tz='UTC'), update_action=1))
    # Revision references an old date but arrives AFTER all tested origins.
    events.append(dict(events[3], price=999, available_at=pd.Timestamp('2016-01-06 20:00',tz='UTC')))
    monkeypatch.setattr(prepare, 'RAW', raw)
    monkeypatch.setattr(prepare, 'OUT', out)
    result = prepare.market_features(pd.DataFrame(events).sort_values('available_at'),
                                     pd.date_range('2016-01-03 08:00','2016-01-05 08:00',tz='UTC'))
    assert result.b7h_contract.tolist() == ['A','A','B']
    # Change on roll is B220 minus B210, not B220 minus A110.
    assert abs(result.x_b7h_change_1.iloc[-1] - 10 / 1.5 * .0745) < 1e-10
    assert abs(result.x_b7h_level.iloc[-1] - 220 / 1.5 * .0745) < 1e-10
