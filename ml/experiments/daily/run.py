"""Daily-only validation experiments. This runner never opens sealed observations.

Run from the app root with ml on PYTHONPATH. See README.md for commands.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from pumphawk_ml.framework import (
    Candidate, SPLITS, baseline_suite, cross_validate, load_frame,
    metrics, score, summarize, training_rows,
)

OUT = Path(__file__).resolve().parent
KEY = [1, 3, 7, 14]
PUMP = ["x_pump_change_1", "x_pump_slope_short", "x_pump_slope_long"]
MARKET = PUMP + ["x_b7h_change_7", "x_b7h_change_14", "x_b7h_change_28", "x_bz_change_7"]
LEVEL = PUMP + ["x_pump_level", "x_b7h_level", "x_bz_level", "x_b7h_curve"]

# Bounded, named hypotheses; no random or exhaustive search.
CANDIDATES = {
    "01_pump_ridge": Candidate("01_pump_ridge", features=PUMP, params={"alpha": 10.0}),
    "02_pump_shrink": Candidate("02_pump_shrink", features=PUMP, params={"alpha": 10.0}, blend=0.5),
    "03_upstream_ridge": Candidate("03_upstream_ridge", features=MARKET, params={"alpha": 10.0}),
    "04_upstream_shrink": Candidate("04_upstream_shrink", features=MARKET, params={"alpha": 100.0}, blend=0.5),
    "05_level_gap": Candidate("05_level_gap", features=LEVEL, params={"alpha": 100.0}, blend=0.5),
    "06_upstream_recent": Candidate("06_upstream_recent", features=MARKET, params={"alpha": 10.0}, train_days=60),
    "07_pump_recent": Candidate("07_pump_recent", features=PUMP, params={"alpha": 10.0}, train_days=60),
    "08_upstream_huber": Candidate("08_upstream_huber", kind="huber", features=MARKET,
                                     params={"alpha": 10.0, "epsilon": 1.35, "max_iter": 2000}),
}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def frame():
    data = load_frame("daily")
    cutoff = pd.Timestamp(SPLITS["daily"]["calibration_start"], tz="UTC")
    assert set(data.frequency) == {"daily"}
    assert (data.origin < cutoff).all()
    assert (data.target_available_at < cutoff).all()
    assert (data.target_available_at > data.origin).all()
    assert set(data.horizon) == set(range(1, 15))
    return data


def results_record(predictions):
    summary = summarize(predictions)
    folds = {str(f): summarize(g) for f, g in predictions.groupby("fold")}
    return {"summary": summary, "key_horizon_mae": score(summary, KEY),
            "all_horizon_mae": score(summary), "folds": folds,
            "key_fold_mae": {f: score(s, KEY) for f, s in folds.items()}}


def save_result(name, predictions, specification=None):
    directory = OUT / "results" / name
    directory.mkdir(parents=True, exist_ok=True)
    record = results_record(predictions)
    if specification:
        record["candidate"] = asdict(specification)
    write_json(directory / "summary.json", record)
    predictions.to_csv(directory / "predictions.csv", index=False)
    print(json.dumps({"name": name, "key_mae": record["key_horizon_mae"],
                      "all_mae": record["all_horizon_mae"],
                      "fold_mae": record["key_fold_mae"],
                      "key": {str(h): record["summary"][str(h)]["mae"] for h in KEY}}), flush=True)


def inspect(data):
    unique = data.drop_duplicates("origin").sort_values("origin")
    report = {"source": "load_frame('daily'); no sealed access", "python": platform.python_version(),
              "eligible_frame_sha256": hashlib.sha256(data.to_csv(index=False).encode()).hexdigest(),
              "origins": len(unique), "start": str(unique.origin.min()), "end": str(unique.origin.max()),
              "last_target_availability": str(data.target_available_at.max()),
              "station_count_min": int(unique.x_station_count.min()),
              "station_count_max": int(unique.x_station_count.max()),
              "anchor_price_min": float(unique.anchor_price.min()),
              "anchor_price_max": float(unique.anchor_price.max()),
              "missing_feature_fraction": {c: float(data[c].isna().mean()) for c in data if c.startswith("x_")},
              "folds": {start: {str(h): {
                  "train": len(training_rows(data, start, h)),
                  "evaluation": int(((data.horizon == h) & (data.origin >= pd.Timestamp(start, tz="UTC")) &
                                     (data.origin < pd.Timestamp(end, tz="UTC"))).sum())}
                  for h in KEY} for start, end in SPLITS["daily"]["folds"]},
              "observed_eligible_months": {str(month): {"origins": len(g), "first_anchor": float(g.anchor_price.iloc[0]),
                    "last_anchor": float(g.anchor_price.iloc[-1]), "first_stations": int(g.x_station_count.iloc[0]),
                    "last_stations": int(g.x_station_count.iloc[-1])}
                  for month, g in unique.groupby(unique.observation_date.dt.strftime("%Y-%m"))}}
    write_json(OUT / "validation-data-audit.json", report)
    print(json.dumps(report, indent=2))


def bootstrap(predictions, reference, block_days=14, repeats=2000):
    joined = predictions.merge(reference, on=["origin", "horizon"], suffixes=("", "_reference"), validate="one_to_one")
    joined["gain"] = abs(joined.actual_delta - joined.predicted_delta_reference) - abs(joined.actual_delta - joined.predicted_delta)
    # Sample origin blocks jointly across horizons, preserving overlapping targets.
    matrix = joined.pivot(index="origin", columns="horizon", values="gain").sort_index().to_numpy()
    rng = np.random.default_rng(42)
    estimates = []
    for _ in range(repeats):
        starts = rng.integers(0, len(matrix), int(np.ceil(len(matrix) / block_days)))
        indices = np.concatenate([(s + np.arange(block_days)) % len(matrix) for s in starts])[:len(matrix)]
        estimates.append(float(np.nanmean(np.nanmean(matrix[indices], axis=0))))
    return {"mean_mae_reduction": float(np.nanmean(np.nanmean(matrix, axis=0))),
            "ci95": np.quantile(estimates, [.025, .975]).tolist(), "origin_block_days": block_days,
            "repeats": repeats, "origin_count": len(matrix), "horizons": sorted(joined.horizon.unique().tolist()),
            "method": "Circular contiguous origin blocks sampled jointly across horizons; equal horizon weighting."}


def freeze(name):
    candidate = CANDIDATES[name]
    predictions = pd.read_csv(OUT / "results" / name / "predictions.csv")
    baselines = {}
    for directory in (OUT / "results").glob("baseline_*"):
        summary = json.loads((directory / "summary.json").read_text())
        baselines[directory.name] = summary["key_horizon_mae"]
    reference_name = min(baselines, key=baselines.get)
    reference = pd.read_csv(OUT / "results" / reference_name / "predictions.csv")
    selected = summarize(predictions)
    base = summarize(reference)
    gain = 1 - score(selected, KEY) / score(base, KEY)
    thresholds = {1: 1.0, 3: 1.5, 7: 2.0, 14: 3.0}
    gate = {"reference": reference_name, "relative_key_mae_reduction": gain,
            "at_least_10pct_reduction": gain >= .10,
            "no_key_horizon_more_than_5pct_worse": all(selected[str(h)]["mae"] <= 1.05 * base[str(h)]["mae"] for h in KEY),
            "absolute_horizon_gates": {str(h): selected[str(h)]["mae"] <= t for h, t in thresholds.items()},
            "key_origin_block_uncertainty": bootstrap(predictions[predictions.horizon.isin(KEY)], reference[reference.horizon.isin(KEY)]),
            "by_horizon_uncertainty": {str(h): bootstrap(predictions[predictions.horizon == h], reference[reference.horizon == h]) for h in KEY},
            "folds": {str(f): {"selected_key_mae": score(summarize(g), KEY),
                      "baseline_key_mae": score(summarize(reference[reference.fold == f]), KEY)}
                      for f, g in predictions.groupby("fold")}}
    write_json(OUT / "selected.json", {str(h): asdict(candidate) for h in range(1, 15)})
    write_json(OUT / "validation-gates.json", gate)
    print(json.dumps(gate, indent=2))


def sensitivity(data):
    specifications = json.loads((OUT / "selected.json").read_text())
    names = {spec["name"] for spec in specifications.values()}
    assert len(names) == 1, "This experiment precommits to one parsimonious family across all horizons."
    candidate = Candidate(**next(iter(specifications.values())))
    original = pd.read_csv(OUT / "results" / candidate.name / "predictions.csv")
    original["origin"] = pd.to_datetime(original.origin, utc=True)
    report = {}
    for target in ("fixed_cohort_target_delta", "fresh14_target_delta"):
        joined = original.merge(data[["origin", "horizon", target]], on=["origin", "horizon"], validate="one_to_one")
        joined["actual_delta"] = joined[target]
        save_result("sensitivity_transfer_" + target, joined)
        alternate = data.copy()
        alternate["target_delta"] = alternate[target]
        _, predictions = cross_validate("daily", candidate=candidate, frame=alternate)
        save_result("sensitivity_refit_" + target, predictions, candidate)
        baseline_metrics = {}
        for name, (_, base_predictions) in baseline_suite("daily", frame=alternate).items():
            save_result("sensitivity_baseline_" + target + "_" + name, base_predictions)
            baseline_metrics[name] = results_record(base_predictions)
        report[target] = {"frozen_prediction_transfer": results_record(joined),
                          "same_spec_refit": results_record(predictions),
                          "baselines": baseline_metrics,
                          "caveat": "Alternate daily target only; primary observed-price input features retained. No sensitivity-based tuning."}
    write_json(OUT / "sensitivity.json", report)


def report():
    rows = []
    for path in sorted((OUT / "results").glob("*/summary.json")):
        if path.parent.name.startswith("sensitivity_"):
            continue
        s = json.loads(path.read_text())
        row = {"name": path.parent.name, "key_mae": s["key_horizon_mae"], "all_mae": s["all_horizon_mae"]}
        row.update({f"day{h}_mae": s["summary"][str(h)]["mae"] for h in KEY})
        row.update({f"fold_{f}": value for f, value in s["key_fold_mae"].items()})
        rows.append(row)
    result = pd.DataFrame(rows).sort_values("key_mae")
    result.to_csv(OUT / "comparison.csv", index=False)
    print(result.to_string(index=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["audit", "baselines", "evaluate", "report", "freeze", "sensitivity"])
    parser.add_argument("names", nargs="*")
    args = parser.parse_args()
    if args.command == "report":
        report()
    elif args.command == "freeze":
        freeze(args.names[0])
    else:
        data = frame()
        if args.command == "audit":
            inspect(data)
        elif args.command == "baselines":
            names = args.names or ["persistence", "momentum_short", "momentum_long", "damped_momentum", "current_heuristic"]
            for name in names:
                _, predictions = cross_validate("daily", baseline_name=name, frame=data)
                save_result("baseline_" + name, predictions)
        elif args.command == "evaluate":
            for name in args.names:
                candidate = CANDIDATES[name]
                _, predictions = cross_validate("daily", candidate=candidate, frame=data)
                save_result(name, predictions, candidate)
        else:
            sensitivity(data)


if __name__ == "__main__":
    main()
