# Can Fuel Finder backfill pump-price history?

Reviewed and tested on 16 September 2026. No application price records were changed by this investigation.

## Finding

The documented Fuel Finder information-recipient API provides the latest prices and incremental updates. It does not expose an as-of-date snapshot or a price-version history endpoint. An older `effective-start-timestamp` selects updates since that timestamp; it does not retrieve each day's earlier prices.

Sources: [Fuel Finder API documentation](https://www.developer.fuel-finder.service.gov.uk/fuel-finder/apis-ifr/info-recipent/docs#operation/getIncrementalPFSFuelPrices) and [GOV.UK access guidance](https://www.gov.uk/guidance/access-the-latest-fuel-prices-and-forecourt-data-via-api-or-email).

## Live verification

Using the existing credentials, requested every batch of:

```http
GET /api/v1/pfs/fuel-prices?batch-number=1&effective-start-timestamp=2026-09-02%2000%3A00%3A00
Host: www.fuel-finder.service.gov.uk
```

The batch number was increased until the final, partial batch.

| Check                                                              |        Result |
| ------------------------------------------------------------------ | ------------: |
| Batches fetched                                                    |            16 |
| Forecourt rows / unique forecourts                                 | 7,896 / 7,896 |
| E10 records                                                        |         7,732 |
| Distinct station/fuel-type pairs                                   |        25,916 |
| Pairs with multiple price versions                                 |             0 |
| E10 records compared with the current-price endpoint's first batch |           498 |
| Identical records, including timestamps                            |           498 |

For example, Attenborough Service Station's 169.9p E10 price effective at 15:53:36 UTC on 16 September appeared in both responses. Requesting a start date fourteen days earlier did not recover that station's earlier prices.

The read-only probe and aggregate result are in the ignored `.local/probe-fuel-history.ts` and `.local/fuel-finder-history-probe.json`. The report contains no tokens or credentials.

## Implications for Pump Hawk

- Continue storing hourly station observations and daily national aggregates as currently implemented.
- Do not group today's prices by their last-change date and call the result historical national averages. That would exclude stations which changed again later, producing a biased subset.
- Do not assume a price before its reported effective date. A complete earlier snapshot plus all subsequent changes would be needed to reconstruct a complete daily series.

## Free historical alternative

[DESNZ weekly road fuel prices](https://www.gov.uk/government/statistics/weekly-road-fuel-prices) provides downloadable UK unleaded petrol and diesel observations. The [CSV preview](https://www.gov.uk/csv-preview/6aa801e097b321a2d34ee250/CSV__2018_-__.csv), updated 15 September, includes:

| Observation date  | UK unleaded petrol, p/L |
| ----------------- | ----------------------: |
| 31 August 2026    |                  161.61 |
| 7 September 2026  |                  164.40 |
| 14 September 2026 |                  168.14 |

These can provide genuine weekly historical context. They cannot supply fourteen daily observations. Any integration should retain the source and frequency, label weekly points, and avoid treating interpolation or differences between providers as observed daily pump-price momentum. Pump Hawk currently computes an unweighted Fuel Finder forecourt mean; DESNZ is a separate statistical series.

Recommendation: show DESNZ as a labelled weekly history series while the app's daily Fuel Finder history accumulates. Daily momentum should continue using comparable daily observations, unless a separately documented weekly fallback is added to the model.
