# Daily model: frozen validation result

**A compact ridge model with daily retail momentum and wholesale changes passes
the provisional validation gates. Its improvement is not statistically secure,
and this is a research result.** The parent owns final calibration and sealed
out-of-time evaluation; those results are intentionally absent from this file.

## Frozen model

`03_upstream_ridge`: independent direct regression for each day 1–14, expanding
training window, ridge alpha 10, no persistence blend. Inputs:

- Last one-day change in the observed E10 pump-price proxy.
- Five-day and fourteen-day pump slopes.
- B7H gasoline futures changes over 7, 14, and 28 days, in indicative GBP p/L.
- BZ Brent futures change over 7 days, in indicative GBP p/L.

Each fold fits its own median imputer, missing-value indicators, scaler, and
ridge estimator using training data only. Coefficients differ by horizon;
feature set and regularization do not. `selected.json` is the portable model
specification. No weekly data, model, or predictions enter this experiment.

The latest daily E10 observed-price snapshot is the anchor. Origin and future
targets are at 08:00 UTC; day 1 means the next day's 08:00 snapshot. Predictions
are changes from the anchor in pence/litre. The current app is unchanged.

## Primary validation

Selection uses equal-weight MAE across days 1, 3, 7, and 14. The strongest single
baseline is the five-day retail slope extrapolated over the forecast horizon.

| Horizon | Cases | Selected MAE | Baseline MAE | RMSE | Bias | P90 absolute error | Idealised regret |
|---|---:|---:|---:|---:|---:|---:|---:|
| Day 1 | 65 | 0.119 | 0.126 | 0.145 | -0.063 | 0.225 | 0.008 |
| Day 3 | 63 | 0.298 | 0.337 | 0.365 | -0.206 | 0.621 | 0.019 |
| Day 7 | 59 | 0.718 | 0.833 | 0.893 | -0.488 | 1.638 | 0.090 |
| Day 14 | 52 | 1.943 | 2.150 | 2.317 | +0.106 | 3.587 | 0.299 |

All price/error columns are p/L. Bias is prediction minus actual. Key-horizon
mean MAE is **0.769 vs 0.862 p/L: a 10.71% reduction**. All absolute error gates
pass, and every key horizon improves. Equal-weight MAE across all 14 horizons
is 0.865 vs 1.017 p/L, a 14.87% reduction. Individual all-horizon errors rise
from 0.119 p/L at day 1 to 1.943 p/L at day 14; exact values are recorded in
`results/03_upstream_ridge/summary.json`.

A stricter diagnostic selects the best validation baseline independently per
horizon: key baseline MAE 0.858 p/L and gain 10.32%. Day 14 changes to damped
momentum; the other three key horizons retain short momentum. The common parent
evaluator uses this per-horizon baseline convention. See
`baseline-envelope-validation.json` for every horizon.

| Fold origins | Model key MAE | Short-momentum key MAE | Interpretation |
|---|---:|---:|---|
| 15 May–4 June | 0.758 | 0.933 | Improvement |
| 5–25 June | 0.440 | 0.495 | Improvement during sustained decline |
| 26 June–eligible July origins | 1.328 | 1.393 | Both substantially weaker around the turn |

The final fold does not contain the same number of cases at each horizon:
23/21/17/10 observations at days 1/3/7/14 after purging labels that enter the
calibration period. The mean of fold means is not the pooled selection score.

Direction accuracy for true moves of at least 0.5 p/L is 100% (2 cases),
100% (36), 90% (50), and 79.2% (48) respectively. The day-1 figure is based on
only two moving cases and provides little evidence. Buy/wait regret is an
idealised binary decision using the future national snapshot, not realized
savings, a tank simulation, or local station advice.

## Uncertainty and target sensitivity

A 2,000-repeat circular bootstrap resampling 14-day origin blocks jointly
across horizons estimates mean MAE reduction at 0.092 p/L with a 95% interval
**[-0.074, +0.237] p/L**. Zero improvement remains plausible. Per-horizon
intervals also cross zero. These intervals do not correct for selecting the
best of eight candidates on the same three folds.

| Alternative target | Frozen forecast transfer MAE | Same specification refit MAE | Best baseline MAE |
|---|---:|---:|---:|
| Fixed initial station cohort | 0.793 | 0.812 | 0.908 |
| Reports at most 14 days old | 0.849 | 0.875 | 0.971 |

Values are equal-weight key-horizon MAE, p/L. Baselines are selected separately
for each sensitivity target: short momentum for fixed cohort, damped momentum
for fresh reports. Sensitivity models retain primary-series input features;
these are label-sensitivity checks, not fully independent alternate pipelines.
No model tuning used the sensitivity outcomes.

Forecast intervals and their empirical coverage require the calibration/test
periods and will be reported by the parent. No probability interval is inferred
from validation MAE or the skill bootstrap.

## Why further tuning stopped

Eight predeclared hypotheses were tested: pump ridge, pump shrink, upstream
ridge, upstream shrink, level/curve model, recent-window upstream model,
recent-window pump model, and Huber upstream model. The compact upstream ridge
was best; the alternatives did not provide more robust improvement. More
parameter searches would reuse a small number of overlapping forecasts rather
than create independent evidence.

The archive spans only part of one year. With 28 days of features the eligible
training frame starts 8 March 2026, leaving 54–67 observations in the earliest
fold depending on horizon. Training contains a large early rise, followed by
flattening and a June fall; these are too few independent regimes to establish
stable pass-through behavior. Validation has 65 forecast origins and only
52 day-14 labels, many sharing nearly the same future price movement.

The reporting station count rises from 6,173 to 7,877 within the eligible frame.
Composition changes can move the equal-station mean. Historical closure flags
are unavailable; present closure status cannot establish past eligibility.
Fixed-cohort and freshness results reduce but do not eliminate this concern.
The model predicts an observed-price proxy, not the exact live open-station
population, a sales-weighted national price, or any individual station.

All current and same-contract market lag features are present in the permitted
March–July frame. This says nothing about future freshness, missing inputs, or
coverage in sealed data. Futures are upstream proxies; density conversion,
settlement timing, lag stability, and provider reporting remain assumptions.

## Reproducibility and checks

`run.py`, `README.md`, `ITERATIONS.md`, `comparison.csv`, all candidate prediction
files/summaries, the eligible-data audits, `selected.json`, sensitivity results,
and `validation-gates.json` are retained. Python 3.12.14 used the shared pinned
dependencies. The eligible-frame hash is
`6eba6793be8a519be4e6998f46a72280cb70d7997bd0224b3dc28eeb93434e25`.

The runner was syntax-checked, its origin-block statistic was checked against
a constant-error fixture, and every selected specification was verified to
use the same seven daily/market features across all 14 horizons. Synthetic
fixtures were never saved as price observations or used for training.
