# Weekly experiment record

## 1. Retail-only baseline and initial model

Shared framework synchronized to `84a9275`. Data were explicitly marked
`market_ready=false`, so no upstream features were used. All runs used the common
six yearly expanding validation folds, with unavailable targets purged. The
first and second observation horizons contain 312 and 311 validation predictions.

| Candidate | First MAE, p/L | Second MAE, p/L | Mean MAE | Mean gain vs strongest baseline |
|---|---:|---:|---:|---:|
| Persistence | 0.8545 | 1.6479 | 1.2512 | −42.2% |
| Short momentum | 0.5411 | 1.2182 | 0.8797 | reference |
| Long momentum | 0.7251 | 1.5588 | 1.1419 | −29.8% |
| Damped momentum | 0.5484 | 1.2765 | 0.9125 | −3.7% |
| Three-lag ridge | 0.5201 | 1.1452 | 0.8327 | 5.34% |

Initial ridge uses retail changes over 7, 14 and 28 calendar days and alpha=10,
with median imputation and scaling fitted within each training fold. It improves
the mean but misses the provisional 10% skill requirement. A paired 8-week block
bootstrap gives a 95% interval of −0.0152 to 0.1100p/L for mean MAE reduction.

The 2022 second-observation fold has MAE 2.6263p/L and 90th-percentile absolute
error 6.2692p/L. The 2021 model regresses against momentum at both horizons,
with negative bias as retail prices trend upward. This motivates robust fitting
and a recent-history sensitivity, rather than a large hyperparameter search.

## 2. Bounded retail-only follow-ups

| Candidate | Change and rationale | First MAE | Second MAE | Mean gain |
|---|---|---:|---:|---:|
| `pump_huber` | Same lags; robust Huber loss reduces shock influence | 0.5199 | 1.1305 | 6.19% |
| `pump_ridge_3y` | Same ridge; train on the preceding three years | 0.5373 | 1.1626 | 3.37% |
| `pump_single_ridge` | Only latest retail change; zero intercept | 0.5277 | 1.1436 | 5.00% |

Shorter history does not improve results. The robust fit is only a small step
forward; its blocked MAE-reduction interval is 0.0016–0.1071p/L, and idealized
decision regret is still slightly worse than momentum. No retail-only candidate
reaches the 10% skill gate. Retail-only tuning stops here pending real market
features. Nothing is frozen and calibration/test remain sealed.

Every result includes candidate parameters, runtime versions, framework hash,
data preparation status, year/horizon metrics and individual predictions under
`results/`. These preliminary runs are retained even if a later model supersedes
them.

## Data-coverage correction before market experiments

Before final data release, the parent audited historical settlement availability.
2015 settlement replays were stale at most weekly forecast origins, so final
supervised training begins January 2016, with 2015 retained only for feature
warmup. This is a source-coverage correction made before sealed evaluation.

The 2015-start preliminary results above are preserved in `initial-retail/`.
All retail candidates and baselines will be rerun on the corrected frame before
comparing upstream models; subsequent `results/` outputs use that common frame.

## 3. Final data and comparable reruns

Shared code synchronized to `ab1c726` and final data marked `market_ready=true`.
Only `load_frame('weekly')` was accessed; the latest permitted target availability
is 25 December 2025. All selected B7H lags have zero missingness from 2016 through
2025. Some 2025 Brent lags/curve are missing, but they are not selected inputs.

The corrected-frame retail results remain below the 10% improvement target:

| Candidate | First MAE | Second MAE | Mean MAE |
|---|---:|---:|---:|
| `pump_ridge` | 0.5204 | 1.1462 | 0.8333 |
| `pump_huber` | 0.5239 | 1.1338 | 0.8289 |
| `pump_ridge_3y` | 0.5373 | 1.1626 | 0.8500 |
| `pump_single_ridge` | 0.5338 | 1.1484 | 0.8411 |

Baseline errors are unchanged because the validation observations are unchanged.
Every final result carries its runtime versions, framework hash and final data
status. Preliminary runs remain separate; they are not included in selection.

## 4. Upstream signal and bounded robustness follow-up

| Candidate | Change and rationale | First MAE | Second MAE | Mean gain |
|---|---|---:|---:|---:|
| `refined_ridge` | Add B7H GBP changes at 3/7/14/28 days | 0.4651 | 0.9061 | 22.06% |
| `market_ridge` | Also add Brent 7/14/28-day and FX 7-day changes | 0.4911 | 0.9345 | 18.97% |
| `refined_huber` | Robust loss on the same seven refined-only inputs | 0.4456 | 0.8710 | 25.16% |

Refined upstream information materially improves MAE and passes the provisional
numerical gates. Crude and FX add complexity without improving mean validation
error. The refined ridge still has a 2023 regression of 15.1% / 26.4% at the two
horizons and positive bias, following the volatile 2022 training year. A single
robust-loss follow-up tests whether shock-sensitive coefficients explain part of
this behavior. It improves mean error and reduces those 2023 regressions to 3.7%
and 15.8%, but does not eliminate that failure regime.

## 5. Frozen result and stopping decision

`refined_huber` is frozen for both horizons. Seven unique candidate configurations
were evaluated on the final data, with no grid search. All four provisional
validation gates pass; paired block uncertainty stays positive for 4/8/13-week
blocks. Further search stops because an acceptable validation candidate has been
found and the remaining concern is generalization, which needs the still-sealed
evaluation rather than additional validation tuning.

No calibration/test target or result was accessed by this agent. The parent was
notified of the freeze before final artifact packaging. Pre-calibration fits
include only 520 / 519 examples whose labels were available before 1 January
2026. Portable fitted coefficients were checked against Python predictions, and
the model bundle's inference interface rejected daily-frequency requests.

`README.md` gives full metrics, adverse-year behavior, direction accuracy,
idealized regret, source limitations and reproduction commands. Actual calibrated
interval coverage and final-test acceptance are explicitly deferred to the
parent's single sealed evaluation.
