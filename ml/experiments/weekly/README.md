# Weekly petrol observation model

## Frozen selection

`refined_huber` is frozen for both weekly horizons in `selected.json`. Across
2020–2025 validation, its mean horizon MAE is **0.6583p/L**, a **25.16% reduction**
against the strongest baseline, recent weekly momentum. All provisional numerical
validation gates pass. Calibration and final test remain sealed for the parent
to evaluate once; this is a research candidate, not a production accuracy claim.

Seven candidate configurations were evaluated on the final common dataset.
The selected model uses a robust linear Huber fit, with epsilon=1.35, alpha=0.1,
max_iter=2000, blend=1 and expanding history. Each horizon gets its own fitted
coefficients. Median imputation and standard scaling are fitted only on each
training fold. Inputs are:

- Released retail-price changes over 7, 14 and 28 calendar days.
- Same-contract B7H GBP pence/litre changes over 3, 7, 14 and 28 days.

All seven selected inputs are present throughout the eligible 2016–2025 history.
Adding Brent and FX features worsened average validation results. Robust loss
improved the refined-only ridge model, especially in 2022 and 2023. No candidate
or parameter changes are permitted after this freeze based on the sealed test.

## Fixed protocol

This experiment predicts the next two **DESNZ weekly reference prices**, separately
at reference-date offsets of 7 and 14 days. These are actual weekly observations;
no daily targets, daily price paths or interpolated values are produced.

The common framework exposes training and validation data only. Forecast issuance
is reference date + 3 days at 08:00 UTC. The targets are therefore approximately
four and eleven days after issuance. Publication timing is assumed and the
government files are revised vintages, so this is not a historical-vintage replay.

Validation uses six expanding yearly folds (2020–2025), with training labels purged
unless they were available before the fold's first forecast origin. Models stay
fixed within each fold. Labels crossing into 2026 are omitted. January–March 2026
is reserved for interval calibration; April 2026 onward is sealed for the parent
agent to evaluate only after the candidate is frozen. Exact dated targets are
used; missing holiday observations are omitted rather than interpolated.

The eligible supervised history begins January 2016. A pre-test source audit
found that 2015 settlement replays were stale at most weekly forecast origins.
Those supervised origins were excluded, retaining 2015 only for feature warmup.
Preliminary 2015-start retail runs are preserved in `initial-retail/`; every
retail candidate and baseline was rerun on the final corrected frame.

The final pre-calibration fits use 520 first-horizon and 519 second-horizon
examples. Their latest target becomes available on 25 December 2025. The six
validation folds contain 312 and 311 scored predictions respectively.

## Validation results

All error amounts below are pence per litre. Positive bias means overprediction.

| Metric                              | First observation | Second observation |
| ----------------------------------- | ----------------: | -----------------: |
| Selected MAE                        |            0.4456 |             0.8710 |
| Strongest baseline MAE              |            0.5411 |             1.2182 |
| Relative MAE improvement            |            17.65% |             28.50% |
| RMSE                                |            0.8025 |             1.4391 |
| Bias                                |           +0.0809 |            +0.2077 |
| 90th-percentile absolute error      |            0.9550 |             1.9528 |
| Direction accuracy on moves ≥0.5p/L |            95.38% |             90.87% |
| Idealized decision regret           |            0.0494 |             0.1096 |
| Baseline idealized decision regret  |            0.0485 |             0.1223 |

Lower forecast MAE does not guarantee a better buying decision: first-horizon
decision regret is slightly worse than momentum. This metric is a simplified
buy-now/wait-to-horizon comparison, not realized driver savings.

### Year and regime robustness

| Validation year | First MAE | First improvement | Second MAE | Second improvement |
| --------------- | --------: | ----------------: | ---------: | -----------------: |
| 2020            |    0.5514 |             12.9% |     0.8798 |              28.9% |
| 2021            |    0.2325 |             17.6% |     0.4938 |              25.5% |
| 2022            |    0.9208 |             17.9% |     1.8360 |              35.5% |
| 2023            |    0.4233 |             −3.7% |     1.0109 |             −15.8% |
| 2024            |    0.2817 |             29.8% |     0.5433 |              38.5% |
| 2025            |    0.2584 |             34.8% |     0.4459 |              43.6% |

**2023 is a real failure regime.** The model overpredicts, with +0.1926p/L and
+0.5325p/L bias at the two horizons, and the second-horizon MAE is 15.8% worse
than momentum. The aggregate 5% regression gate is a per-horizon gate, not a
guarantee for every year. In volatile 2022, the second-horizon 90th-percentile
absolute error is still 4.2858p/L despite improved MAE.

Paired bootstrap resampling uses consecutive forecast origins, jointly across
both horizons and separately within each validation year. With 8-week blocks and
4,000 repetitions, the 95% interval for the mean MAE reduction is
**0.1305–0.3210p/L**, around a point estimate of 0.2213p/L. Four- and thirteen-week
block sensitivities also stay positive. This conditions on the observed regime
mix and does not correct for selecting among seven candidates. It is uncertainty
about comparative mean error, not a prediction interval.

Prediction-interval calibration and coverage are deliberately not estimated from
future labels here. The parent must use the reserved January–March 2026 segment
for intervals and report April-onward test coverage and performance once.

## Limits and intended use

- Targets are revised, sales-weighted DESNZ national weekly observations, not
  the live equal-station daily Fuel Finder aggregate or a particular forecourt.
- Historical release vintages and exact publication timestamps are unavailable;
  the conservative release convention cannot remove revised-vintage bias.
- B7H is an upstream futures proxy with assumed density, not a direct retail
  quotation. Changes cannot anticipate future supply or policy shocks.
- A single 2022 shock regime, limited yearly sample sizes and the 2023 regression
  prevent claims of stable performance in every market condition.
- The application and its live forecasting behavior have not been changed.

## Reproduction

From the app root, with the shared Python environment and processed data:

```sh
PYTHONPATH=ml .local/ml-venv/bin/python ml/experiments/weekly/run.py --baseline --candidate pump_ridge --candidate pump_huber --candidate pump_ridge_3y --candidate pump_single_ridge --candidate refined_ridge --candidate market_ridge --candidate refined_huber --compare
PYTHONPATH=ml .local/ml-venv/bin/python ml/experiments/weekly/report.py
PYTHONPATH=ml .local/ml-venv/bin/python ml/experiments/weekly/fit_selected.py
```

`run.py` uses `load_frame('weekly')` without sealed access and persists each
candidate specification, every validation prediction, aggregate metrics and
year/horizon fold metrics. `--spec` also accepts a saved `Candidate` specification.
The runtime rejects market-feature experiments while shared data are marked
incomplete. `report.py` reads only saved validation outputs; `fit_selected.py`
uses only `load_frame('weekly')` and the pre-calibration cutoff.

The final tested inference artifact is `ml/artifacts/weekly/model.json`; see [the final results](../../TRAINING_RESULTS.md). The following files preserve the earlier pre-calibration experiment.

`fitted/h7.json` and `fitted/h14.json` contain portable fitted linear coefficients,
imputation and scaling values. Their reconstructed predictions were verified
against the fitted Python pipeline. The ignored `fitted/precalibration.pkl`
contains a bundle for `pumphawk_ml.inference.predict`; it declares frequency
`weekly` and rejects a daily request. It has no calibrated interval radius yet.
Only trusted local pickle files should be loaded.

## Experiment plan

1. Establish persistence, short/long momentum and damped momentum baselines.
2. Fit a three-feature retail-history ridge model.
3. Test whether same-contract GBP refined-product changes improve retail history;
   then assess incremental crude/FX inputs.
4. Make a bounded number of robustness improvements guided by validation.
5. Freeze one portable `Candidate` per horizon, document regime failures and
   blocked uncertainty estimates; hand off the still-sealed evaluation.

The research acceptance target is mean horizon MAE at least 10% below the strongest
validation-selected baseline, next-observation MAE at most 2p/L, second-observation
MAE at most 3p/L, and neither horizon over 5% worse than its strongest baseline.

## Artifacts

- `selected.json`: frozen portable candidate specifications.
- `selected-validation-report.json`: gate decisions, full metrics and uncertainty.
- `selected-validation-predictions.csv`: every selected validation prediction.
- `results/`: all seven final candidate runs and four baseline runs.
- `initial-retail/`: preserved preliminary runs before the source-coverage fix.
- `EXPERIMENT_LOG.md`: validation-led progression and stopping rationale.
- `validation-data-audit.json`: accessible date bounds and yearly feature coverage.
- `fitted/`: portable fitted parameters and ignored local Python bundle.
