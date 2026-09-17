# Pump Hawk model experiments

See [training results](TRAINING_RESULTS.md) for the selected models, held-out accuracy, data coverage and remaining uncertainty limitations.

Two independent model families share data preparation and evaluation code:

- **Weekly:** official DESNZ sales-weighted petrol observations; outputs only the next two weekly observation dates. No interpolation, daily labels, or daily forecasts from weekly training.
- **Daily:** FuelCosts E10 events, reconstructed at 08:00 UTC each day; predicts the snapshot at the same time on each of the next 14 calendar days. Equal-station observed-price proxy: historical closure state is unavailable, so exact live open-station eligibility cannot be claimed. Fixed initial cohort, freshness and present-day closure sensitivity series are retained.

The application forecast is not changed by these research scripts. Existing sample prices never enter training.

## Use the trained models

Both fitted models are ready for inference and integration:

| Model  | Portable artifact                                | Outputs                               |
| ------ | ------------------------------------------------ | ------------------------------------- |
| Daily  | [daily/model.json](artifacts/daily/model.json)   | Each of the next 14 days              |
| Weekly | [weekly/model.json](artifacts/weekly/model.json) | Next two official weekly observations |

Run either model from the app root with Python 3.10 or newer; inference from JSON needs no third-party packages, data downloads or retraining:

```sh
python3 ml/scripts/predict.py daily --features ml/artifacts/daily/example-input.json
python3 ml/scripts/predict.py weekly --features ml/artifacts/weekly/example-input.json
```

The example inputs are dated historical fixtures, not current market readings. Replace them with features prepared under the matching frequency and availability rules below. `anchor_price` is the observed price in pence per litre; pump/futures changes are also pence per litre, and pump slopes are pence per litre per day. Features must use the training definitions in `scripts/prepare.py`. The JSON artifacts contain the required feature names, imputation values, scaling and fitted coefficients. `pumphawk_ml.inference.predict_portable` also provides a callable interface and rejects a frequency mismatch.

These are the fitted models used in the held-out evaluation. Their `research_only` status records that they have not been enabled in the application. Point-accuracy gates passed; the daily 14-day uncertainty band remains inadequately calibrated. See [training results](TRAINING_RESULTS.md) before exposing probability claims.

## Run

From the app root, create a Python 3.12 virtual environment at `.local/ml-venv`, install `ml/requirements.lock`, then:

```sh
python ml/scripts/acquire.py public
python ml/scripts/acquire.py fuelcosts
python ml/scripts/acquire.py quote
python ml/scripts/acquire.py market --max-usd 5
python ml/scripts/prepare.py
PYTHONPATH=ml python -m pytest ml/tests
```

After the independent agents freeze their specifications, the parent runs `PYTHONPATH=ml python ml/scripts/evaluate_frozen.py weekly` and the corresponding `daily` command. The test-opening marker rejects changed selections or changed datasets after that first evaluation. Trusted local fitted artifacts are saved to `.local/model-artifacts`; `pumphawk_ml.inference.predict` enforces frequency matching. These artifacts are research-only unless the report explicitly accepts them for a later app integration.

Use that environment's Python. `PUMP_HAWK_ROOT` overrides the app root; `PUMP_HAWK_DATA` overrides the processed-data directory for training. Credentials are read only from the existing API `.dev.vars`, never copied into worktrees. Public price files are cached under `.local/model-data/raw`; FuelCosts uses the pinned export audited in `../MARKET_DATA_BACKFILL.md`. ECB reference rates come directly from its public data API because Frankfurter rejected this historical request.

This directory is a normal part of the app workspace. Both agents' changes have been consolidated here, and the temporary nested Git repository and worktrees have been removed. Credentials and raw data remain outside the model deliverables; local data and evaluation bundles stay under `.local/`.

## Fixed evaluation protocol

Defined in `pumphawk_ml/framework.py` before model experimentation:

| Model  | Validation forecast origins                | Interval calibration   | Sealed test origins      |
| ------ | ------------------------------------------ | ---------------------- | ------------------------ |
| Weekly | Six expanding yearly folds, 2020–2025      | Jan–Mar 2026           | Apr–Sep 2026             |
| Daily  | Three expanding folds, 15 May–19 July 2026 | 20 July–14 August 2026 | 15 August–September 2026 |

All fitting is purged by **target availability**, not just the age of forecast origins. Validation labels must be observable before calibration starts. Calibration labels must be observable before the test begins. The final test may be read only after a candidate is frozen; do not tune on it or repeatedly retry candidates against it. Hyperparameters and training-window choices are selected on validation only. The calibration segment is for residual intervals, not candidate selection.

Provisional acceptance: average MAE at least 10% below the strongest validation-selected baseline; no key horizon more than 5% worse; MAE no greater than 1 p/L at 1 day, 1.5 p/L at 3 days, 2 p/L at 7 days and 3 p/L at 14 days. Weekly thresholds are 2 p/L and 3 p/L for the next two observation weeks. Apply the same numerical criteria to the sealed test. Report uncertainty and small-sample limitations even if the numerical gates pass. These are research acceptance targets, not established product promises.

Report MAE, RMSE, bias, tail error, direction on moves of at least 0.5 p/L, interval coverage, and idealised buy-now/wait decision regret. Decision regret is not a full simulation of tank constraints, travel patterns, local station responses or realised customer savings. Use blocked uncertainty estimates to reflect overlapping horizons. Compare persistence, recent momentum, damped momentum, and (daily only) a documented approximation of the current heuristic. Limit experimentation to meaningful model/feature changes; stop and explain the obstacle when gains fail to generalise.

## Data availability and market features

- Daily observations use `max(recorded_at, source_updated_at)` as availability. Out-of-order stale source updates cannot replace a newer source value. No backward filling before a station's first observation; invalid replacement prices invalidate that station until another valid record arrives.
- Current closure flags are a sensitivity analysis only. The fixed cohort is selected from stations already observed on the first full archive day, without looking forward for station survival.
- Weekly observations conservatively become available three days after their reference date at 08:00 UTC. Thus a Thursday forecast predicts the following Monday and the Monday after that: horizons 7 and 14 denote distance between reference observations, not seven/fourteen days after issuance. This release-time assumption and the use of revised government CSVs are limitations; exact historical release vintages are unavailable.
- Futures use B7H and BZ statistics, final non-intraday settlements, historical instrument definitions and calendar-ranked nearby contracts from 2015 onwards. Match definitions as of the settlement receipt, retain corrections/deletions, and only expose settlement events received by the forecast origin.
- Changes compare the same raw contract and expiry across both ends of each lag. Expired contracts are excluded at the forecast origin; do not compare different front contracts across a rollover or back-adjust with information learned in the future.
- GBP/USD is computed from ECB USD/EUR divided by GBP/EUR. Assume conservative 18:00 UTC daily FX availability. Settlement values use matching reference-date FX or a prior rate within five days. No future rate filling.
- B7H p/L proxy uses assumed density 0.745 kg/L. Brent uses 158.987294928 litres/barrel. They are upstream signals, not retail price quotations.

The data manifest and audits include hashes, coverage and missing-market-signal fractions. Any claim about the weekly model's long history must respect actual settlement coverage; an earlier government observation does not establish an earlier B7H observation.

The assembled feed audit found predominantly weekly replay settlements in early 2015, which were stale by Thursday issuance under the five-day freshness rule. Weekly training therefore starts in January 2016; 2015 remains feature warmup. Current B7H/BZ signals are available throughout the 2016–2026 eligible weekly frame and the daily frame. Monthly nearby-contract definition snapshots avoid repeatedly downloading unchanged definitions while retaining point-in-time timestamps; some complete yearly definition files obtained during the initial download are also retained.

## Agent isolation contract

Agents use the shared framework but write only under their assigned `experiments/weekly` or `experiments/daily` directory. Each should train an initial candidate, perform a bounded sequence of validation-driven changes, record every candidate, and freeze `selected.json` mapping horizon strings to `Candidate` dictionaries. They must not access sealed calibration/test rows, change acceptance gates, download paid data, expose secrets or change the app. Report shared-framework bugs to the parent for a common fix. Only the parent opens the test after selection is frozen.
