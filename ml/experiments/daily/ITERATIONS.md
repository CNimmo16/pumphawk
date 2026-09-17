# Daily experiment log

## Initial retail-only frame

Shared framework: `84a9275`. All data used via `load_frame('daily')`; upstream
acquisition was still running. Only retail-only candidates and the four
retail-only baselines ran. The production heuristic was deliberately deferred
until usable market signals were present. The initial eligible-frame hash and
missing-market audit are preserved in `initial-retail-data-audit.json`.

| Candidate | Key-horizon MAE, p/L | Day 1 | Day 3 | Day 7 | Day 14 |
|---|---:|---:|---:|---:|---:|
| Short momentum baseline | 0.862 | 0.126 | 0.337 | 0.833 | 2.150 |
| Damped momentum baseline | 0.877 | 0.128 | 0.348 | 0.897 | 2.135 |
| Initial three-feature ridge | 1.038 | 0.132 | 0.375 | 0.988 | 2.658 |
| Ridge, 50% blend toward no change | 1.029 | 0.147 | 0.438 | 1.056 | 2.475 |
| Ridge, last 60 training days | 1.208 | 0.128 | 0.410 | 1.250 | 3.043 |

The planned 60-day retail-only hypothesis ran while upstream acquisition
continued. It did not remedy the initial failure. No model was frozen.

The first fold has only 54–67 training observations depending on horizon. The
last fold has only 10 day-14 labels because labels reaching calibration are
excluded. Retail prices rose sharply during March training, largely flattened
through May, fell in June, then began to turn during the final validation fold.
Recent momentum works very well during the sustained June decline and poorly
around the next turn; stronger damping reverses that pattern. This is evidence
of regime sensitivity, not grounds to select different models after observing
which regime occurred.

Next: run the already specified upstream and robust candidates after the parent
confirms that point-in-time market features are ready. Record all outcomes,
including failures. Calibration and test remain sealed.

## Point-in-time market frame and final freeze

Shared framework update: `43a7a39`. The final validation-eligible market frame has
no missing current B7H/BZ levels or same-contract lag features at any of the
eligible origins. This statement applies to the permitted March–July frame,
not to the sealed periods. Its hash is in `validation-data-audit.json`.
The corrected production-style heuristic applies faster-rise/slower-cut pace
separately for each market before weighting the market scenarios.

| Candidate | Key-horizon MAE, p/L | Validation conclusion |
|---|---:|---|
| Pump + market changes, ridge alpha 10 | **0.769** | Best overall; all key horizons improve |
| Same features, Huber loss | 0.801 | Better than retail-only; no improvement over ridge |
| Stronger regularization and 50% shrink | 0.941 | Too much shrinkage during the June decline |
| Same upstream ridge, 60-day window | 1.036 | Unstable long-horizon training; worse overall |
| Pump/futures levels plus curve | 1.107 | No useful gain with this short history |
| Current heuristic approximation | 1.104 | Good in two folds, poor during sustained decline |

No additional feature search or tuning was performed. The compact upstream
ridge improves all three fold-average MAEs versus the chosen short-momentum
baseline: 0.758 vs 0.933, 0.440 vs 0.495, and 1.328 vs 1.393 p/L.
The third fold is still substantially weaker for both methods.

`03_upstream_ridge` was frozen for all 14 direct daily horizons before any
sensitivity results were examined or before the parent opened test data.
Commands:

```sh
$PY experiments/daily/run.py freeze 03_upstream_ridge
$PY experiments/daily/run.py sensitivity
```

The relative MAE gain is 10.71% over the strongest single baseline. A diagnostic
comparison against the stronger independently selected per-horizon baseline
also passes the 10% threshold (10.32%). Day 14 uses damped momentum in that
comparison; days 1, 3, and 7 use short momentum. No candidate selection changed.

The 95% origin-block confidence interval for absolute MAE reduction is
[-0.074, 0.237] p/L, crossing zero. The numerical pass is therefore provisional.
Sensitivity checks retain the frozen model: transfer MAE is 0.793 p/L for the
fixed initial cohort and 0.849 p/L for the fresh-report target; refitting the
same specification gives 0.812 and 0.875 p/L respectively. Primary features
were retained in every target sensitivity experiment. See `RESULTS.md` and the
machine-readable artifacts for complete metrics and limitations.
