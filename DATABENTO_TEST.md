# Databento Eurobob API test

Tested: 16 September 2026, following explicit authorisation to use the API key in `services/api/.dev.vars`.

## Result

**Direct historical API downloads work. B7H returned usable final Eurobob settlements for 15 September 2026. GNO returned no settlement prices for that day.**

| Product             | Statistics records | Definition records | Settlement messages | Final outright contracts |
| ------------------- | -----------------: | -----------------: | ------------------: | -----------------------: |
| `GNO.FUT` — non-oxy |                160 |                 40 |                   0 |                        0 |
| `B7H.FUT` — oxy     |              1,130 |                412 |                 202 |                       14 |

GNO's statistics were exclusively upper/lower price-limit messages (`stat_type` 17/18), with blank prices. A separate metadata count reported zero GNO trade records in the same interval. Definitions nevertheless resolved September, October and November as `GNOU6`, `GNOV6` and `GNOX6`.

B7H had multiple settlement revisions. The extracted September, October and November values have `stat_flags = 3`: final and actual, with the intraday flag unset. Their reference date is 15 September. Definition records identify the outright contracts as `B7HU6`, `B7HV6` and `B7HX6`, quoted in USD per metric tonne. The parent download also contains spreads; these were excluded from the extracted results using `instrument_class = F`.

The volume/open-interest records in this one-day download refer to **14 September**, so they must not be attached to 15 September as though they had the same reference date. Settlements, volume and open interest require independent date joins.

This is evidence for one day only. It establishes B7H as a practical candidate for a longer backfill test; it does not establish GNO's availability on other days or validate a forecast model. B7H remains the oxy benchmark, not an interchangeable non-oxy price.

### Follow-up: why GNO has no settlements

A subsequent read-only `metadata.get_record_count` check for `GNO.FUT`, `schema=trades`, from `2026-08-17T00:00:00Z` inclusive to `2026-09-16T00:00:00Z` exclusive returned **0 trade records across 30 days**. No additional time-series data was downloaded for this check.

Databento documents that CME omits settlements from its MDP feed for instruments without open interest or volume. Combined with the absence of GNO trades and the successful resolution of its definitions, this makes low activity in the CME contract the leading explanation. Missing open-interest records do not independently prove zero open interest, and the check does not cover other venues or OTC transactions. [CME feed documentation](https://databento.com/docs/venues-and-datasets/glbx-mdp3)

For comparison, the previously downloaded B7H records explicitly report 248, 107 and 133 outstanding contracts for September, October and November respectively, referenced to 14 September. GNO's closer relationship to E10 blendstock therefore does not establish that its CME futures feed is the more useful data source.

## Exact request

The dataset-range endpoint reported an available end of `2026-09-16T04:14:05.044002000Z`. The latest complete UTC day was therefore selected:

```text
POST https://hist.databento.com/v0/timeseries.get_range
Content-Type: application/x-www-form-urlencoded

dataset=GLBX.MDP3
symbols=GNO.FUT                 # repeated separately with B7H.FUT
stype_in=parent
schema=statistics               # repeated separately with definition
start=2026-09-15T00:00:00Z
end=2026-09-16T00:00:00Z
encoding=csv
compression=none
pretty_px=true
pretty_ts=true
map_symbols=true
```

These are four separate requests. Authentication used HTTP Basic with the locally read key as username and an empty password. The key was not printed, embedded in a URL, supplied as a command-line argument, or written to the downloaded files.

The interval is inclusive at the start and exclusive at the end, filtering these schemas by receipt timestamp. The export already formats prices as decimal values; no additional 1e-9 conversion was applied. Sources: [HTTP API and authentication](https://databento.com/docs/api-reference-historical?historical=http), [time-series request](https://databento.com/docs/api-reference-historical/timeseries/timeseries-get-range?historical=http&live=http), [CME flags and reference dates](https://databento.com/docs/venues-and-datasets/glbx-mdp3).

All four downloads returned HTTP 200, totalling **372,388 bytes** of CSV. The requests did not set a record limit, so the counts describe the complete responses for this interval.

## Cost estimates

The `metadata.get_cost` endpoint was checked before each pair of downloads:

| Product/schema  |      Estimated USD |
| --------------- | -----------------: |
| GNO statistics  |     0.000011920929 |
| GNO definitions |     0.000032931566 |
| B7H statistics  |     0.000084191561 |
| B7H definitions |     0.000339195132 |
| **Total**       | **0.000468239188** |

These are API estimates, not a checked invoice or account balance. No subscription or licence settings were changed.

## Downloaded files

Stored in `.local/databento/2026-09-15/`; `.local/` is excluded by `.gitignore`.

- [GNO statistics](.local/databento/2026-09-15/gno-statistics.csv)
- [GNO definitions](.local/databento/2026-09-15/gno-definition.csv)
- [B7H statistics](.local/databento/2026-09-15/b7h-statistics.csv)
- [B7H definitions](.local/databento/2026-09-15/b7h-definition.csv)
- [Three B7H delivery months, final settlements](.local/databento/2026-09-15/b7h-front-months.csv)
- [Machine-readable result summary](.local/databento/2026-09-15/summary.json)

The summary joins definitions by publisher and instrument ID and retains the latest qualifying final end-of-day settlement per instrument/reference date. It includes all 14 final outright contracts and a separate three-month extraction. Validation confirmed all three requested B7H delivery months have final, actual settlements for 15 September.

The downloaded data has not been imported into application tables or connected to the forecast/SMS services. The next integration decision should use these observed coverage results alongside [PRICES.md](PRICES.md), including the distinction between futures and observed wholesale prices.
