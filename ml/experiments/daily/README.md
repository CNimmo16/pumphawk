# Daily E10 observed-price model

**Outcome:** `03_upstream_ridge` is frozen for days 1–14. It passes provisional
validation gates; uncertainty remains wide. See [RESULTS.md](RESULTS.md) for the
model card and [ITERATIONS.md](ITERATIONS.md) for all experiment decisions.

## Scope and protocol

This is an independent daily model experiment. It never loads weekly labels,
weekly predictions, synthetic sample prices, raw event files, credentials, or the
sealed calibration/test observations. All experiment data comes through
`load_frame('daily')`, which excludes origins and target availability at or after
20 July 2026. The parent process owns final interval calibration and sealed test
evaluation after `selected.json` is frozen.

The target is the change in an equal-station UK E10 observed-price proxy for each
of the next 1–14 calendar days. Historical closure membership is unavailable, so
this is not an exact reconstruction of the live open-station series or a forecast
for an individual forecourt. Shared preparation uses 08:00 UTC daily snapshots;
all input events must be available by the forecast origin, and horizon `h` is the
snapshot exactly `h` calendar days later. Features use only daily pump history and
point-in-time market information. B7H and BZ changes compare the same futures
contract, with GBP conversion using available matching-date FX.

Three expanding folds start 15 May, 5 June, and 26 June 2026 and end 5 June,
26 June, and 20 July. Training labels must be available strictly before each
fold begins. Evaluation targets must be available strictly before calibration
begins. Models are fitted once at each fold boundary, rather than refitted using
later labels inside a fold. This is a demanding fixed-model validation protocol.

## Bounded experiment sequence

1. Fit three-feature pump ridge regression and a 50% blend toward persistence.
   The inputs are last-day pump change, five-day slope, and fourteen-day slope.
2. Test whether the known wholesale lag adds useful information: add B7H changes
   over 7, 14, and 28 days and BZ change over 7 days. Test a stronger regularized,
   shrunk version and a price-level/futures-curve version as separate hypotheses.
3. If generalization remains weak, test a 60-day training window and robust
   regression. Stop after these named hypotheses unless validation reveals a
   specific correctable implementation issue.

`run.py` contains all portable `Candidate` specifications; this is a short list
of economic/modeling hypotheses, not a hyperparameter grid. One specification is
selected across all 14 horizons to limit selection variance. Independent direct
regressions are fitted for each horizon. There is no recursive roll-forward and
no daily interpolation from a weekly model.

Selection emphasizes the equally weighted MAE at days 1, 3, 7, and 14, while
recording all-day average error, individual horizons, and each validation fold.
The comparator is the single baseline with the lowest key-horizon average MAE
among persistence, short momentum, long momentum, damped momentum, and the shared
documented approximation of the production heuristic. The precommitted gates
are at least 10% lower average error, no key horizon more than 5% worse, and
absolute MAE at most 1, 1.5, 2, and 3 p/L at the four key horizons respectively.
Passing a numerical gate alone does not establish reliability with this short
history and very few independent overlapping forecast windows.

Every run saves its configuration, all 14-horizon summaries, per-fold summaries,
and individual out-of-fold predictions under `results/`. Error reports include
RMSE, bias, 90th-percentile absolute error, direction accuracy conditional on a
true move of at least 0.5 p/L, action accuracy, and idealised buy/wait regret.
Direction accuracy excludes small true moves; action accuracy does not.
Regret is not a tank, route, local-pricing, or realized-savings simulation.

Validation uncertainty uses 2,000 circular moving-block bootstrap samples of
14 forecast origins, sampling all horizons jointly and retaining equal horizon
weight. Reported confidence intervals are exploratory: overlapping targets,
only three folds, and selection on these same folds limit interpretation.

## Sensitivity checks

After freezing, evaluate the same forecast changes against fixed-initial-cohort
and at-most-14-day-old-reporting targets. Also refit the frozen specification to
each sensitivity target using the identical folds. Input features remain those
of the primary observed-price series. These are target/label sensitivity checks,
not complete alternative production pipelines, and do not select models.

## Reproduce

From the app root, use the shared pinned Python environment:

```sh
export PYTHONPATH=ml
PUMP_HAWK_PYTHON=.local/ml-venv/bin/python
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py audit
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py baselines
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py evaluate 01_pump_ridge 02_pump_shrink
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py evaluate 03_upstream_ridge 04_upstream_shrink 05_level_gap
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py evaluate 06_upstream_recent 07_pump_recent 08_upstream_huber
$PUMP_HAWK_PYTHON ml/experiments/daily/run.py report
# Freeze and sensitivity commands are recorded in RESULTS.md after selection.
```

The processed-data path defaults to the shared
`.local/model-data/processed`; `PUMP_HAWK_DATA` may override it. Do not substitute
`include_sealed=True`. `validation-data-audit.json` records a SHA-256 of the
eligible frame, coverage, missing features, station-count range, and fold sizes.
Final parent evaluation can reconstruct each model directly from `selected.json`
through the common `Candidate`/`predict_candidate` API.

The independent sealed evaluation is complete; see [the final results](../../TRAINING_RESULTS.md). The app forecast is unchanged. The tested inference artifact is `ml/artifacts/daily/model.json`; the daily 14-day uncertainty limitation remains.
