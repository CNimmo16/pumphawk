"""Bounded, cached acquisition. Credentials never appear in URLs or outputs."""
import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import os
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(os.environ['PUMP_HAWK_ROOT']) if 'PUMP_HAWK_ROOT' in os.environ else next(p for p in Path(__file__).resolve().parents if (p / 'PRICES.md').exists())
DATA = ROOT / '.local/model-data'
RAW = DATA / 'raw'


def credentials():
    for line in (ROOT / 'services/api/.dev.vars').read_text().splitlines():
        if line.startswith('DATABENTO_API_KEY='):
            key = line.split('=', 1)[1].strip().strip('\"\'')
            return {'Authorization': 'Basic ' + base64.b64encode((key + ':').encode()).decode()}
    raise RuntimeError('Databento credentials missing')


def metadata(method, params):
    assert method in ('metadata.get_cost', 'metadata.get_record_count', 'metadata.get_dataset_range', 'symbology.resolve')
    req = urllib.request.Request('https://hist.databento.com/v0/' + method + '?' + urllib.parse.urlencode(params), headers=credentials())
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def requests():
    # Three calendar-ranked outrights retain the history of a new front contract
    # before a roll. Actual return calculations still join the SAME raw contract.
    for schema in ('definition', 'statistics'):
        for product in ('B7H', 'BZ'):
            yield dict(dataset='GLBX.MDP3', symbols=','.join(f'{product}.c.{i}' for i in range(3)),
                       stype_in='continuous', schema=schema, start='2015-01-01', end='2026-09-16')


def quote():
    components = []
    for params in requests():
        item = {'params': params, 'cost_usd': metadata('metadata.get_cost', params)}
        if not isinstance(item['cost_usd'], (int, float)):
            raise RuntimeError('Invalid quote')
        components.append(item)
        print(json.dumps(item), flush=True)
    report = dict(quoted_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  components=components, total_usd=sum(x['cost_usd'] for x in components))
    (DATA / 'databento-quote.json').write_text(json.dumps(report, indent=2))
    print('TOTAL_QUOTED_USD', report['total_usd'], flush=True)


def download_market(cap):
    report = json.loads((DATA / 'databento-quote.json').read_text())
    if report['total_usd'] > cap:
        raise RuntimeError('Total quote exceeds cost cap')
    ledger_path = DATA / 'download-ledger.json'
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
    parts = []
    for item in report['components']:
        for year in range(2015, 2027):
            if item['params']['schema'] == 'definition':
                product = item['params']['symbols'].split('.')[0]
                completed_year = RAW / f'{product}-definition-{year}.csv.gz'
                if completed_year.exists() and any(x['file'] == completed_year.name and x.get('complete') for x in ledger):
                    continue
                # Three nearby definitions on each month's first day cover the
                # front and next contracts throughout that month. Definitions
                # remain timestamped; no future snapshot is joined backwards.
                for month in range(1, 10 if year == 2026 else 13):
                    parts.append({'params': dict(item['params'], start=f'{year}-{month:02d}-01', end=f'{year}-{month:02d}-02')})
            else:
                params = dict(item['params'], start=f'{year}-01-01', end=f'{year+1}-01-01' if year < 2026 else '2026-09-16')
                parts.append({'params': params})
    lock = threading.Lock()
    def download_part(item):
        params = item['params']
        product = params['symbols'].split('.')[0]
        suffix = params['start'][:7] if params['schema'] == 'definition' else params['start'][:4]
        path = RAW / f'{product}-{params["schema"]}-{suffix}.csv.gz'
        if path.exists() and any(x['file'] == path.name and x.get('complete') for x in ledger):
            print('CACHED', path.name, flush=True)
            return
        cost = metadata('metadata.get_cost', params)
        entry = dict(file=path.name, params=params, cost_estimate_usd=cost, complete=False,
                     requested_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        with lock:
            charged = sum(x['cost_estimate_usd'] for x in ledger)
            if not isinstance(cost, (int, float)) or charged + cost > cap:
                raise RuntimeError('Fresh quote exceeds remaining cost cap')
            ledger.append(entry)
            ledger_path.write_text(json.dumps(ledger, indent=2))
        body = urllib.parse.urlencode(dict(params, encoding='csv', compression='none',
                                          pretty_px='true', pretty_ts='true', map_symbols='false', stype_out='instrument_id')).encode()
        req = urllib.request.Request('https://hist.databento.com/v0/timeseries.get_range', data=body, headers=credentials())
        digest = hashlib.sha256()
        count = 0
        tmp = path.with_suffix('.partial')
        try:
            response = urllib.request.urlopen(req, timeout=240)
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read())
            safe = detail.get('detail', {})
            with lock:
                entry.update(rejected=True, cost_estimate_usd=0, http_status=error.code)
                ledger_path.write_text(json.dumps(ledger, indent=2))
            # Only provider validation diagnostics; never request headers.
            print(json.dumps({'status': error.code, 'detail': safe}), flush=True)
            raise RuntimeError('Databento request rejected') from None
        with response, gzip.open(tmp, 'wb') as out:
            while chunk := response.read1(64 * 1024):
                count += len(chunk)
                if count > 1_500_000_000:
                    raise RuntimeError('Download exceeded size bound')
                digest.update(chunk)
                out.write(chunk)
                out.flush()
        tmp.rename(path)
        with lock:
            entry.update(complete=True, uncompressed_bytes=count, sha256_uncompressed=digest.hexdigest())
            ledger_path.write_text(json.dumps(ledger, indent=2))
        print(json.dumps(entry), flush=True)
    # Bound concurrency and reserve each fresh quote in one shared ledger.
    # Recent data first lets the shorter daily experiment become ready sooner.
    parts.sort(key=lambda x: x['params']['start'], reverse=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(download_part, parts))


def download_public():
    url_file = DATA / 'gov-csv-urls.json'
    if not url_file.exists():
        with urllib.request.urlopen('https://www.gov.uk/government/statistics/weekly-road-fuel-prices', timeout=60) as response:
            html = response.read().decode()
        urls = list(dict.fromkeys(u.replace('&amp;', '&') for u in re.findall(r'href="([^"]+)"', html)
                                  if '.csv' in u and 'assets.publishing' in u))
        url_file.write_text(json.dumps(urls, indent=2))
    urls = list(dict.fromkeys(json.loads(url_file.read_text())))
    manifest = []
    for i, url in enumerate(urls):
        path = RAW / f'desnz-{i}.csv'
        if not path.exists():
            with urllib.request.urlopen(url, timeout=60) as response:
                path.write_bytes(response.read())
        manifest.append(dict(file=path.name, url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    url = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP.EUR.SP00.A?startPeriod=2014-12-01&endPeriod=2026-09-15&format=csvdata'
    path = RAW / 'ecb-fx.csv'
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    manifest.append(dict(file=path.name, url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (DATA / 'public-manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest), flush=True)


def download_fuelcosts():
    revision = '0549348f44d917e0fc94dead6a64677598736921'
    directory = ROOT / '.local/fuelcosts'
    directory.mkdir(parents=True, exist_ok=True)
    manifest = []
    for filename in ['README.md', 'price_history.csv', 'stations.csv']:
        path = directory / filename
        url = f'https://huggingface.co/datasets/jamesb7/fuel-prices-uk/resolve/{revision}/{filename}'
        if not path.exists():
            temporary = path.with_suffix('.partial')
            size = 0
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 250_000_000:
                        raise RuntimeError('FuelCosts export exceeds expected size')
                    out.write(chunk)
            temporary.rename(path)
        manifest.append(dict(file=filename, revision=revision, url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (DATA / 'fuelcosts-manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['quote', 'public', 'market', 'fuelcosts'])
    parser.add_argument('--max-usd', type=float, default=5)
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    {'quote': quote, 'public': download_public, 'fuelcosts': download_fuelcosts, 'market': lambda: download_market(args.max_usd)}[args.action]()
