"""Point-in-time feature construction; daily labels never use weekly prices."""
import bisect
import csv
import hashlib
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(os.environ['PUMP_HAWK_ROOT']) if 'PUMP_HAWK_ROOT' in os.environ else next(p for p in Path(__file__).resolve().parents if (p / 'PRICES.md').exists())
DATA = ROOT / '.local/model-data'
RAW, OUT = DATA / 'raw', DATA / 'processed'
UTC = 'UTC'


def utc(value):
    return pd.to_datetime(value, utc=True, format='mixed')


def daily_prices():
    station = pd.read_csv(ROOT / '.local/fuelcosts/stations.csv').set_index('node_id')
    coords = station.latitude.between(49, 61) & station.longitude.between(-9, 3)
    eligible = set(station[coords].index)
    rows = pd.read_csv(ROOT / '.local/fuelcosts/price_history.csv')
    rows = rows[rows.fuel_type == 'E10'].copy()
    rows['recorded'] = utc(rows.recorded_at)
    rows['source'] = utc(rows.source_updated_at)
    rows['available'] = rows[['recorded', 'source']].max(axis=1)
    audit = {'e10_events': len(rows), 'future_source_timestamps': int((rows.source > rows.recorded).sum()),
             'source_timestamp_policy': 'Available at max(recorded_at, source_updated_at); never move observations backwards.',
             'historical_closures': 'Unavailable; target is an equal-station observed-price proxy, not exact open-station membership.'}
    rows = rows[rows.source.notna() & rows.node_id.isin(eligible)].sort_values(['available', 'id'])
    # Last partial London day is excluded. Last fully observed day is 2026-09-15.
    last_full = rows.recorded.max().tz_convert('Europe/London').normalize().date() - pd.Timedelta(days=1)
    days = pd.date_range('2026-02-08', str(last_full), freq='D')
    events = iter(rows.itertuples())
    event = next(events, None)
    state, cohort, output = {}, set(), []
    stale_updates = invalid = 0
    for day in days:
        cutoff = day.tz_localize('UTC') + pd.Timedelta(hours=8)
        while event is not None and event.available < cutoff:
            previous = state.get(event.node_id)
            if previous is not None and event.source < previous[1]:
                stale_updates += 1
            else:
                price = event.price_pence if np.isfinite(event.price_pence) and 30 <= event.price_pence <= 600 else np.nan
                invalid += not np.isfinite(price)
                state[event.node_id] = (price, event.source, event.recorded)
            event = next(events, None)
        if not cohort:
            cohort = {key for key, value in state.items() if np.isfinite(value[0])}
        values = [v[0] for v in state.values() if np.isfinite(v[0])]
        fixed = [v[0] for key, v in state.items() if key in cohort and np.isfinite(v[0])]
        fresh = [v[0] for v in state.values() if np.isfinite(v[0]) and (cutoff - v[2]).days <= 14]
        current_open = [v[0] for key, v in state.items() if np.isfinite(v[0])
                        and not station.loc[key, 'is_permanently_closed'] and not station.loc[key, 'is_temporarily_closed']]
        output.append(dict(date=day.date().isoformat(), price=round(float(np.mean(values)), 3), station_count=len(values),
                           fixed_cohort_price=float(np.mean(fixed)), fixed_cohort_count=len(fixed),
                           fresh14_price=float(np.mean(fresh)), fresh14_count=len(fresh),
                           current_open_sensitivity_price=float(np.mean(current_open)),
                           available_at=cutoff.isoformat()))
    result = pd.DataFrame(output)
    result.to_csv(OUT / 'daily-prices.csv', index=False)
    audit.update(stale_source_updates_ignored=stale_updates, invalid_events=invalid, days=len(result),
                 first_date=result.date.iloc[0], last_date=result.date.iloc[-1], initial_cohort=len(cohort),
                 primary_vs_fixed_mean_absolute_gap=float(abs(result.price - result.fixed_cohort_price).mean()))
    (OUT / 'daily-audit.json').write_text(json.dumps(audit, indent=2))
    return result


def weekly_prices():
    frames = []
    for path in RAW.glob('desnz-*.csv'):
        df = pd.read_csv(path, encoding='utf-8-sig')
        df = df.iloc[:, [0, 1, 3, 5]].copy()
        df.columns = ['date', 'price', 'duty', 'vat']
        df['date'] = pd.to_datetime(df.date, dayfirst=True, errors='coerce')
        df = df.dropna(subset=['date', 'price'])
        frames.append(df)
    frame = pd.concat(frames).drop_duplicates('date').sort_values('date')
    # Conservative release assumption: Thursday 08:00 UTC after the reference
    # Monday, accommodating Tuesday/Wednesday publication and bank holidays.
    # Archived release vintages unavailable: this remains a revised-data backtest.
    frame['available_at'] = frame.date.dt.tz_localize('UTC') + pd.Timedelta(days=3, hours=8)
    frame.to_csv(OUT / 'weekly-prices.csv', index=False)
    return frame


def market_events():
    out = []
    audit = {}
    for product in ('B7H', 'BZ'):
        defs = pd.concat([pd.read_csv(p, usecols=['ts_recv', 'publisher_id', 'instrument_id', 'raw_symbol', 'instrument_class', 'expiration', 'asset']) for p in sorted(RAW.glob(f'{product}-definition-*.csv.gz'))], ignore_index=True)
        defs = defs[(defs.instrument_class == 'F') & (defs.asset == product)].copy()
        defs['definition_at'] = utc(defs.ts_recv)
        defs['expires_at'] = utc(defs.expiration)
        defs['key'] = defs.publisher_id.astype(str) + ':' + defs.instrument_id.astype(str)
        defs = defs[['definition_at', 'expires_at', 'key', 'raw_symbol']].sort_values('definition_at').drop_duplicates(['definition_at', 'key'], keep='last')
        chunks = []
        counts = Counter()
        for chunk in (chunk for path in sorted(RAW.glob(f'{product}-statistics-*.csv.gz')) for chunk in pd.read_csv(path, chunksize=250000)):
            counts['all_statistics'] += len(chunk)
            flags = chunk.stat_flags.fillna(0).astype(int)
            chunk = chunk[(chunk.stat_type == 3) & ((flags & 1) == 1) & ((flags & 8) == 0)].copy()
            counts['final_nonintraday_events'] += len(chunk)
            chunks.append(chunk)
        stats = pd.concat(chunks, ignore_index=True)
        stats['available_at'] = utc(stats.ts_recv)
        stats['reference'] = utc(stats.ts_ref).dt.normalize()
        stats['key'] = stats.publisher_id.astype(str) + ':' + stats.instrument_id.astype(str)
        stats = stats.sort_values('available_at')
        merged = pd.merge_asof(stats, defs, left_on='available_at', right_on='definition_at', by='key', direction='backward')
        counts['unmatched_definitions'] = int(merged.expires_at.isna().sum())
        merged = merged.dropna(subset=['expires_at', 'reference'])
        merged = merged[(merged.price.between(.001, 10000)) | (merged.update_action == 2)]
        merged['contract'] = merged.raw_symbol + '|' + merged.expires_at.dt.strftime('%Y-%m-%d')
        merged['product'] = product.lower()
        out.append(merged[['product', 'contract', 'raw_symbol', 'reference', 'price', 'available_at', 'expires_at', 'update_action', 'stat_flags']])
        counts['first_reference'] = str(merged.reference.min())
        counts['last_reference'] = str(merged.reference.max())
        audit[product] = dict(counts)
    events = pd.concat(out).sort_values('available_at').drop_duplicates()
    events.to_csv(OUT / 'settlement-events.csv', index=False)
    (OUT / 'market-audit.json').write_text(json.dumps(audit, indent=2))
    return events


def market_features(events, origins=None):
    fx = pd.read_csv(RAW / 'ecb-fx.csv')
    fx = fx.pivot(index='TIME_PERIOD', columns='CURRENCY', values='OBS_VALUE').dropna()
    fx['usd_per_gbp'] = fx.USD / fx.GBP
    fx.index = pd.to_datetime(fx.index, utc=True)
    # Reference rates published during afternoon; conservative availability 18:00 UTC.
    fx['available_at'] = fx.index + pd.Timedelta(hours=18)
    fx.to_csv(OUT / 'fx.csv')
    if origins is None:
        origins = pd.date_range('2015-01-01 08:00', '2026-09-16 08:00', tz='UTC')
    state = {}
    current = iter(events.itertuples())
    event = next(current, None)
    rows = []
    for origin in origins:
        while event is not None and event.available_at <= origin:
            key = (event.product, event.contract, event.reference)
            if event.update_action == 2:
                state.pop(key, None)
            else:
                state[key] = event
            event = next(current, None)
        # Expired contracts and reference dates beyond every feature lookback
        # cannot contribute to future rows. Bound replay state without changing
        # the point-in-time join or keeping a hindsight-adjusted continuous price.
        state = {k: v for k, v in state.items() if v.expires_at > origin and (origin - v.reference).days <= 70}
        rates = fx[fx.available_at <= origin]
        latest_fx = rates.iloc[-1].usd_per_gbp if len(rates) else np.nan
        row = dict(origin=origin, x_fx=latest_fx)
        for lag in (1, 7, 28):
            past = fx[fx.available_at <= origin - pd.Timedelta(days=lag)]
            row[f'x_fx_change_{lag}'] = latest_fx / past.iloc[-1].usd_per_gbp - 1 if len(past) else np.nan
        for product, multiplier in [('b7h', .0745), ('bz', 100 / 158.987294928)]:
            candidates = [v for (p, _, ref), v in state.items() if p == product and v.expires_at > origin
                          and ref <= origin and (origin - ref).days <= 5]
            row[f'x_{product}_missing'] = 1
            if not candidates:
                continue
            nearest_expiry = min(v.expires_at for v in candidates)
            value = max((v for v in candidates if v.expires_at == nearest_expiry), key=lambda v: v.reference)
            rate_at_ref = rates[rates.index <= value.reference]
            if rate_at_ref.empty or (value.reference - rate_at_ref.index[-1]).days > 5:
                continue
            price = value.price / rate_at_ref.iloc[-1].usd_per_gbp * multiplier
            row[f'x_{product}_missing'] = 0
            row[f'x_{product}_level'] = price
            row[f'x_{product}_age'] = (origin - value.reference).total_seconds() / 86400
            row[f'{product}_contract'] = value.contract
            row[f'{product}_available_at'] = value.available_at
            history = [v for (p, contract, ref), v in state.items() if p == product and contract == value.contract]
            for lag in (1, 3, 7, 14, 28):
                boundary = value.reference - pd.Timedelta(days=lag)
                eligible = [v for v in history if v.reference <= boundary and (boundary - v.reference).days <= 5]
                if not eligible:
                    row[f'x_{product}_change_{lag}'] = np.nan
                    continue
                old = max(eligible, key=lambda v: v.reference)
                old_rates = rates[rates.index <= old.reference]
                if old_rates.empty or (old.reference - old_rates.index[-1]).days > 5:
                    continue
                old_price = old.price / old_rates.iloc[-1].usd_per_gbp * multiplier
                row[f'x_{product}_change_{lag}'] = price - old_price
            later = [v for v in candidates if v.expires_at > nearest_expiry]
            if later:
                expiry = min(v.expires_at for v in later)
                next_value = max((v for v in later if v.expires_at == expiry), key=lambda v: v.reference)
                if next_value.reference == value.reference:
                    row[f'x_{product}_curve'] = (next_value.price - value.price) / rate_at_ref.iloc[-1].usd_per_gbp * multiplier
        row['x_crack_proxy'] = row.get('x_b7h_level', np.nan) - row.get('x_bz_level', np.nan)
        rows.append(row)
    result = pd.DataFrame(rows)
    result.to_csv(OUT / 'market-features.csv', index=False)
    return result


def supervised(mode, prices, market):
    prices = prices.copy()
    prices['date'] = utc(prices.date).dt.normalize()
    prices['available_at'] = utc(prices.available_at)
    prices = prices.set_index('date').sort_index()
    market = market.set_index('origin')
    weekly = mode == 'weekly'
    horizons = (7, 14) if weekly else range(1, 15)
    output = []
    for date, anchor in prices.iterrows():
        origin = anchor.available_at
        if origin not in market.index or date < pd.Timestamp('2015-02-01', tz=UTC):
            continue
        # Early2015 CME final statistics are predominantly weekly replays and
        # stale at Thursday issuance. Keep2015 as warmup, train from2016.
        if weekly and date < pd.Timestamp('2016-01-01', tz=UTC):
            continue
        if not weekly and date < pd.Timestamp('2026-03-08', tz=UTC):
            continue
        past = prices[(prices.index <= date) & (prices.available_at <= origin)]
        row = dict(market.loc[origin])
        row.update(origin=origin, observation_date=date, frequency=mode, anchor_price=anchor.price,
                   x_pump_level=anchor.price, x_month_sin=np.sin(2 * np.pi * date.dayofyear / 365.25),
                   x_month_cos=np.cos(2 * np.pi * date.dayofyear / 365.25))
        lags = (7, 14, 28, 56) if weekly else (1, 3, 7, 14, 28)
        for lag in lags:
            prev = past[past.index <= date - pd.Timedelta(days=lag)]
            row[f'x_pump_change_{lag}'] = anchor.price - prev.iloc[-1].price if len(prev) else np.nan
        # Five-day daily slope matches the current production heuristic.
        short_lag, long_lag = (7, 28) if weekly else (5, 14)
        for name, lag in [('short', short_lag), ('long', long_lag)]:
            previous = past[past.index <= date - pd.Timedelta(days=lag)]
            row[f'x_pump_slope_{name}'] = (anchor.price - previous.iloc[-1].price) / (date - previous.index[-1]).days if len(previous) else 0
        recent = past.tail(5 if weekly else 14)
        row['x_pump_volatility'] = float(recent.price.diff().std())
        if weekly:
            row['x_duty'] = anchor.duty
            row['x_vat'] = anchor.vat
        else:
            row['x_weekday_sin'] = np.sin(2 * np.pi * date.dayofweek / 7)
            row['x_weekday_cos'] = np.cos(2 * np.pi * date.dayofweek / 7)
            row['x_station_count'] = anchor.station_count
            previous = past[past.index <= date - pd.Timedelta(days=7)]
            row['x_station_count_change_7'] = anchor.station_count - previous.iloc[-1].station_count if len(previous) else 0
            row['x_cohort_gap'] = anchor.price - anchor.fixed_cohort_price
        for h in horizons:
            target_date = date + pd.Timedelta(days=h)
            # Exact dated labels only. Missing bank-holiday observations are omitted.
            if target_date not in prices.index:
                continue
            target = prices.loc[target_date]
            record = dict(row, horizon=h, target_date=target_date, target_available_at=target.available_at,
                          target_delta=target.price - anchor.price, target_price=target.price)
            if not weekly:
                record['fixed_cohort_target_delta'] = target.fixed_cohort_price - anchor.fixed_cohort_price
                record['fresh14_target_delta'] = target.fresh14_price - anchor.fresh14_price
            output.append(record)
    result = pd.DataFrame(output)
    assert (result.target_available_at > result.origin).all()
    result.to_csv(OUT / f'{mode}-supervised.csv', index=False)
    return {'rows': len(result), 'origins': result.origin.nunique(), 'start': str(result.origin.min()), 'end': str(result.origin.max()),
            'market_missing_fraction': {p: float(result[f'x_{p}_missing'].mean()) for p in ('b7h', 'bz')}}


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    daily = daily_prices()
    print('Daily prepared', len(daily), flush=True)
    weekly = weekly_prices()
    events = market_events()
    print('Settlements prepared', len(events), flush=True)
    market = market_features(events)
    report = {mode: supervised(mode, prices, market) for mode, prices in [('daily', daily), ('weekly', weekly)]}
    report['weekly_availability_assumption'] = 'Reference date + 3 days at 08:00 UTC. Conservative release lag, revised vintages not reconstructed.'
    report['files'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.glob('*.csv')}
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)
