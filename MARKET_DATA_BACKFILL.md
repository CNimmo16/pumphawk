# Historical pump prices and Databento cost estimate

Investigated on 16 September 2026. Downloaded and inspected only the free FuelCosts exports. Databento calls were restricted to free metadata endpoints; no market data was downloaded and no order was placed. Application data and forecasting behaviour were not changed.

## FuelCosts coverage

Source: [FuelCosts downloads](https://fuelcosts.co.uk/download), which links to [jamesb7/fuel-prices-uk on Hugging Face](https://huggingface.co/datasets/jamesb7/fuel-prices-uk). The dataset states Open Government Licence v3.0, with attribution to FuelCosts and the government Fuel Finder scheme.

The complete CSV exports were inspected at repository revision `0549348f44d917e0fc94dead6a64677598736921`:

| Measure                                                         | Result                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| First observed price record                                     | 7 February 2026, 21:40:01 UTC                                |
| Latest observed price record                                    | 15 September 2026, 23:44:03 UTC (16 September, 00:44:03 BST) |
| Complete intervening UK calendar days                           | 8 February–15 September: 220 days                            |
| All-fuel price records                                          | 1,062,276                                                    |
| E10 price records                                               | 319,822                                                      |
| Distinct stations with E10 records                              | 8,025                                                        |
| Stations in directory, all fuels                                | 8,458                                                        |
| Calendar dates without any E10 records inside the covered range | 0                                                            |

The first and last UK days are partial. The presence of records every day does not prove uninterrupted collection or complete station coverage. The oldest `source_updated_at` is in February 2025, but that is an old price's reported update time, not evidence of an observed nationwide history beginning then. Use `recorded_at` to establish archive coverage and information availability.

Known stations with valid E10 prices grew from approximately 5,231 on the first day to 8,018 on 15 September, before applying historical closure status. Coverage first exceeded 7,000 on 14 March and 7,500 on 14 April. Changes in coverage can move a national mean without a like-for-like price change; retain daily station counts and assess a stable-station comparison alongside the primary series.

## Matching Pump Hawk's national weighting

The agreed target is the application's existing **equal-weight arithmetic mean of valid, open E10 forecourts**. Every eligible station contributes one price, regardless of brand, sales volume or number of price changes. Motorway stations remain included, as they are in the live national series.

```text
national_price(day) = sum(latest eligible E10 price for each station at cutoff)
                     / number of eligible stations at cutoff
```

For the eventual import:

1. Reconstruct station state at a consistent daily cutoff in `Europe/London`, respecting daylight saving. Preserve observation time as well as source time so historical forecasts cannot see later information.
2. Carry a station's last observed price forward until an observed replacement. Do not extend its history backwards before its first observation. Do not average only stations which changed price that day.
3. Reuse the live validation policy: E10 only; finite prices from 30 through 600 p/L; valid timestamps; valid UK station coordinates; closed stations excluded. The audit found 327 E10 events outside the price bounds.
4. Some source timestamps occur after their recording time: 8,202 E10 records, all within an hour. Resolve this timestamp inconsistency before import rather than exposing those values before they are available/effective. The audit means do not yet resolve this issue.
5. Retain the day's contributing station count, source and provenance. Use the same aggregation function for historical and live observations, rounding only the resulting mean to the current three decimal places.

**Historical station status limitation:** `stations.csv` contains current closure flags and first/last-seen timestamps, not a dated closure event history. These two exports alone cannot establish exactly which stations were open on every historical day. Applying today's closure flags to all past days creates selection bias. Historical directory snapshots or another explicit, documented treatment are needed before claiming exact eligibility parity. The equal-weight formula itself can be matched.

The generated `daily-coverage.csv` is exploratory: it includes means without closure filtering and a sensitivity calculation using current closure flags. Neither is a production-ready national series. No values were imported into Postgres.

## Databento estimate

Queried at `2026-09-16T16:27:50Z` using the configured account. [Databento's documentation](https://databento.com/docs/reference-historical/basics/) states that metadata calls are free and `metadata.get_cost` estimates historical download cost, respecting flat-rate discounts.

Requests cover `2026-02-07T00:00:00Z` through **exclusive** `2026-09-16T00:00:00Z`, covering the completed pump-history period. Both request boundaries are whole UTC days, matching the estimator's documented accuracy conditions.

| Product / schema            | Estimated records |   Estimated cost, USD |
| --------------------------- | ----------------: | --------------------: |
| B7H gasoline / `statistics` |           199,698 |             $0.014879 |
| BZ Brent / `statistics`     |         5,576,768 |             $0.415502 |
| B7H / `definition`          |            82,544 |             $0.067958 |
| BZ / `definition`           |         1,699,670 |             $1.399320 |
| **Total**                   |                   | **$1.897658 ≈ $1.90** |

Adding a **28-day futures feature warm-up**, beginning 10 January 2026 with the same exclusive end, costs **$2.150564 ≈ $2.15 total**. This adds earlier upstream observations for lagged inputs; it does not create earlier pump-price history.

Exact request selection:

```text
dataset  = GLBX.MDP3
stype_in = parent
symbols  = B7H.FUT or BZ.FUT
schema   = statistics or definition
start    = 2026-02-07 (or 2026-01-10 with warm-up)
end      = 2026-09-16
```

These are deliberately broad contract-family estimates. `statistics` contains more than final settlements; `definition` supplies instrument identity, expiry and outright/spread classification. A later importer would filter for outright contracts and final daily settlement statistics, selecting contracts active at each historical date. It must not use only the contracts that remain unexpired today. Narrowing the selection may reduce the cost further.

The estimates concern historical data usage for the specified requests. No final-settlement completeness claim is possible from record counts alone; that would be checked after an authorized download. GBP/USD history must also be aligned with these observations using the existing ECB/Frankfurter source.

## Local evidence

- `.local/fuelcosts/audit.json`: pinned export URLs, byte counts, SHA-256 digests, date ranges and counts.
- `.local/fuelcosts/quality.json`: timestamp anomalies and coverage milestones.
- `.local/fuelcosts/daily-coverage.csv`: exploratory daily coverage and means.
- `.local/databento-history-quote.json`: exact quote parameters, record counts, prices and dataset availability.
- `.local/audit-fuelcosts.py`: downloads and audits only the free FuelCosts exports.
- `.local/estimate-databento-history.mjs`: an allowlisted quote-only script using `metadata.get_cost`, `metadata.get_record_count` and `metadata.get_dataset_range`. It contains no download or purchase endpoint and does not print credentials.

Raw exports and audit outputs stay in the ignored `.local` directory. The chosen revision and hashes make this investigation reproducible even as the publisher updates its daily export.
