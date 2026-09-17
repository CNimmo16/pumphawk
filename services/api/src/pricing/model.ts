import daily from "../../../../ml/artifacts/daily/model.json";
import weekly from "../../../../ml/artifacts/weekly/model.json";

export type Frequency = "daily" | "weekly";
export type Features = Record<string, number | null>;
export const models = { daily, weekly };
type Linear = (typeof daily.models)["1"];

// Same preprocessing and linear inference as ml/pumphawk_ml/inference.py.
// PRICES.md: weekly outputs are never interpolated into daily forecasts.
export function predictModel(
  frequency: Frequency,
  features: Features,
  declaredFrequency: Frequency = frequency,
) {
  if (declaredFrequency !== frequency)
    throw new Error("Model frequency mismatch");
  const bundle = models[frequency];
  if (!Number.isFinite(features.anchor_price))
    throw new Error("Missing anchor price");
  return Object.entries(bundle.models)
    .map(([horizon, raw]) => {
      const model: Linear = raw;
      const missing = model.features.map(
        (name) => features[name] == null || !Number.isFinite(features[name]),
      );
      const values = model.features.map((name, i) =>
        missing[i] ? model.imputation_values[i]! : features[name]!,
      );
      values.push(
        ...model.missing_indicator_indices.map((i: number) =>
          Number(missing[i]),
        ),
      );
      const terms = values.map(
        (value, i) =>
          ((value - model.scaler_mean[i]!) / model.scaler_scale[i]!) *
          model.coefficients[i]! *
          model.blend,
      );
      const contributions = {
        pump: 0,
        b7h: 0,
        crude: 0,
        baseline: model.intercept * model.blend,
      };
      terms.forEach((term, i) => {
        const name = model.features[i] ?? "baseline";
        const group = name.startsWith("x_pump_")
          ? "pump"
          : name.startsWith("x_b7h_")
            ? "b7h"
            : name.startsWith("x_bz_")
              ? "crude"
              : "baseline";
        contributions[group] += term;
      });
      const change = Object.values(contributions).reduce((a, b) => a + b, 0);
      return {
        horizon: Number(horizon),
        price: features.anchor_price! + change,
        change,
        contributions,
        radius: model.empirical_interval_radius_ppl,
        imputed: model.features.filter((_, i) => missing[i]),
      };
    })
    .sort((a, b) => a.horizon - b.horizon);
}
