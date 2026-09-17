# Training history for Pump Hawk

Follow-up: the user authorised acquiring the data and training separate weekly and daily models. The implementation, frozen evaluation protocol and model results now live in [ml/README.md](ml/README.md). The research recommendations below record the earlier investigation; the two model families do not turn weekly observations into daily labels or forecasts.

Investigated on 16 September 2026. This is a research recommendation, not a model implementation. Four small, free Kaggle archives were downloaded and their CSV rows inspected. No paid market data was downloaded or purchased, and application data was not changed.

## Is February onwards enough?

FuelCosts provides 220 complete intervening UK calendar days, from 8 February through 15 September 2026. Its first and last days are partial. See [the archive audit](MARKET_DATA_BACKFILL.md) for coverage, timestamp and station-eligibility limitations.

This is enough for an initial experiment with a small regularised regression or an estimated version of the current lag model. It is a weak basis for concluding that a replacement will remain accurate across seasons and different market conditions:

- Once station prices are aggregated, the national target contains about 220 daily observations. The 319,822 E10 price events do not become that many independent national training examples.
- Lagged features, future labels and a held-out evaluation period further reduce usable training origins. Consecutive 14-day forecast windows overlap, so their errors are also correlated.
- The archive does not cover one full annual cycle. More daily observations from one sustained price trend cannot substitute for examples of both rising and falling markets and turning points.
- Station coverage changes substantially during the archive. A changing set of stations can move the average even without a like-for-like price movement.

**Practical target:** seek at least two to three recent years of comparable daily observations, and preferably more if they remain relevant. This is an engineering preference, not a statistical minimum or a guarantee. Model complexity, noise, structural changes and out-of-sample performance determine what is sufficient. [Forecasting: Principles and Practice explains why there is no universal minimum length and why shorter series favour simpler models.](https://otexts.com/fpp3/long-short-ts.html)

## Longer sources checked

Kaggle date ranges and counts below were calculated from the downloaded CSVs rather than inferred from dataset titles.

| Source                                                                                                                         | Verified coverage / observations                               | Frequency                        | Assessment                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESNZ weekly road fuel prices](https://www.gov.uk/government/statistics/weekly-road-fuel-prices)                              | June 2003 onwards; latest publication covers 14 September 2026 | Weekly                           | Strongest free long national series found; use the original government release rather than a stale Kaggle mirror. Government material is available under the Open Government Licence subject to its stated exceptions. |
| [Kaggle: UK Petrol and Diesel Prices, Samith](https://www.kaggle.com/datasets/samithsachidanandan/uk-petrol-and-diesel-prices) | 9 June 2003–3 February 2025; 1,131 dated rows                  | Weekly                           | Government-series mirror. Publisher metadata labels it CC0, but retain the original government attribution and provenance.                                                                                             |
| [Kaggle: Fuel Prices UK, Ugowda](https://www.kaggle.com/datasets/ugowda/fuel-prices-uk)                                        | 9 June 2003–1 April 2024; 1,087 dated rows                     | Weekly                           | Another government-series mirror; description cites the Open Government Licence.                                                                                                                                       |
| [Kaggle: UK Fuel Prices, Abbas](https://www.kaggle.com/datasets/abbas829/uk-fuel-prices)                                       | 2 January 2013–28 April 2026; 318 dated rows                   | Irregular, roughly twice monthly | Includes pump and delivered-wholesale prices. Too sparse to supply daily labels. Publisher declares CC BY-SA 4.0, but original source, methodology and rights to the underlying data need verification.                |
| [Kaggle: UK Petrol Prices, Sandip](https://www.kaggle.com/datasets/sandipdevre/uk-petrol-prices)                               | 9 June 2003–20 April 2020; 881 dated rows                      | Weekly                           | Columns are labelled USD despite values consistent with the government pence-per-litre series. Prefer the original government data.                                                                                    |

The search did **not** establish a free, commercially reusable multi-year UK daily station-price archive that can be aggregated exactly like Pump Hawk. This is a finding about the sources checked, not proof that no such archive exists.

## Preserve the national target definition

Pump Hawk uses an equal-weight mean: each eligible E10 station contributes one current price. The government series is a different target. The [CMA's description of its methodology](https://assets.publishing.service.gov.uk/media/64a2811506179b000c1ae914/Appendices_and_glossary.pdf), Annex A paragraphs 3–4, describes company-level average prices weighted by annual sales, rather than an equal-weight average of all stations.

An already aggregated sales-weighted series cannot be converted back into the desired equal-station mean without its underlying observations. Accordingly:

1. Keep FuelCosts/Fuel Finder as the daily target, using the same aggregation formula in historical and live processing, with the eligibility limitations documented in the archive audit.
2. Treat DESNZ as a separate series for studying one- and two-week price changes, upstream pass-through and behaviour in older market conditions.
3. Do not splice DESNZ levels directly into the app's national history or interpolate its weekly observations into apparently observed daily training labels.
4. A model trained on DESNZ changes could be tested as an additional signal and calibrated against the overlapping daily target. Similar movement is a hypothesis to validate, not an assumption that makes the weighting mismatch disappear.
5. Older observations require attention to changes in fuel specification, tax, retailer composition and market behaviour. Compare recent training windows with longer ones instead of automatically using every year available.

## If multi-year daily station history is required

**Experian Catalist is a credible commercial lead.** The CMA reports acquiring station-level prices for 7,649 sites, sampled on Wednesdays and Saturdays between 3 June 2017 and 14 May 2023. This establishes that multi-year site-level history exists, but does not establish a currently offered daily backfill, its completeness, its price or its licence for commercial model training and publishing derived forecasts. The reported data comes from fuel-card transactions and is not a complete observed price for every station on every day. [Source: CMA Annex A, paragraphs 4–5.](https://assets.publishing.service.gov.uk/media/64a2811506179b000c1ae914/Appendices_and_glossary.pdf)

No provider was contacted and no quote was requested as part of this investigation.

## Recommended next experiment

- Start a small daily model using FuelCosts, B7H, Brent and GBP/USD with only a few economically motivated lagged features. Keep the current deterministic forecast and a no-change forecast as benchmarks.
- Use rolling, chronological evaluation at 1, 3, 7 and 14 days. At each evaluation origin, train only on labels already observable at that time; fit preprocessing within each training window. Evaluate forecast error, direction, uncertainty coverage and the resulting fill-up decisions.
- Use only upstream observations available at each historical forecast time, with a consistent futures contract-roll rule. Do not select historical contracts based on which contracts are unexpired today.
- Separately test a small weekly model on recent years of DESNZ observations paired with upstream prices available at each forecast origin. Evaluate whether its one- and two-week movement signal helps the daily model on the overlapping period.
- Preserve recent data for final evaluation and report the limited span explicitly. Promote an ML model only if it improves held-out results sufficiently; the archive's length alone cannot establish that.

## Local evidence

The ignored `.local/longer-history/` directory contains public Kaggle dataset metadata, four downloaded ZIP files and `kaggle-file-audit.json`, including filenames, date counts, first/last rows and common intervals. These downloads were research inputs only and were not imported into Postgres.
