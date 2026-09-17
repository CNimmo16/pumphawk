# Pump Hawk pricing research

## Supplied research

The key to timing your fill-ups is to monitor **wholesale refined product prices in Pounds**, rather than raw Brent crude oil in US Dollars. Because of the **1 to 2 week supply chain lag**, changes in wholesale costs take a few days to hit the pumps.

### Rules of Thumb for Fill-Up Timing

- **Wait to fill up if:** Wholesale costs have been dropping steadily for 3 to 7 days, and you are not on empty. Supermarket forecourts usually trigger the first wave of price cuts, with independent sites following a few days later.
- **Fill up immediately if:** Crude oil or wholesale prices spike abruptly due to geopolitical events or supply disruptions. Retailers adjust prices upward ("rockets") far faster than they cut them ("feathers").
- **Fill up mid-week:** Independent market tracking shows prices at regional forecourts are often marginally lower on Tuesday or Wednesday mornings before weekend travel demand spikes.
- **Avoid highway fill-ups entirely:** Motorway service station forecourts consistently charge 20p–30p/litre above the national average regardless of market trends due to high overheads and captive traffic.

### What to Track vs. What to Ignore

| Signal                                      | Meaning for Pump Prices                                     | Action                                             |
| ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| **Wholesale Petrol/Diesel (in GBP) down**   | Retail prices will likely fall over the next **7–14 days**. | **Wait** (fill up only what you need).             |
| **Wholesale Petrol/Diesel (in GBP) rising** | Retail prices will likely increase within **24–48 hours**.  | **Fill up now** before the delivery hits.          |
| **GBP crashing against USD**                | Import costs rise even if crude oil price stays flat.       | **Fill up soon**—prices will creep up.             |
| **Brent Crude drops in USD only**           | Meaningless if the Pound weakened at the same time.         | **Ignore** until converted to GBP wholesale rates. |

## Implementation policy (assumptions, not additional research)

The live daily ridge and weekly Huber models are served by `services/api/src/pricing/model.service.ts`, using the frozen fitted coefficients in `ml/artifacts/`. Feature construction matches `ml/scripts/prepare.py`. The daily model alone supplies buying advice; weekly predictions remain a separate official benchmark. The heuristic in `live-forecast.ts` is a labelled fallback for missing or stale model inputs. `/api/v1/demo` remains synthetic.

### Stored inputs

- **Petrol:** Databento `GLBX.MDP3`, B7H European gasoline futures, final end-of-day settlement statistics (`stat_type=3`, final flag, excluding intraday flags). Prices are USD per metric tonne. Outright definitions determine contract expiry; spreads and expired contracts are excluded.
- **Crude:** the same dataset, CME BZ Brent Last Day Financial futures, USD per barrel. This is a secondary corroborating signal; it is not interchangeable with refined petrol.
- **FX:** daily ECB GBP/USD reference rates from its direct data API. Divide USD prices by USD-per-GBP once. Match each settlement to that day's rate, or the most recent rate within five calendar days for holidays/weekends.
- **Pump:** government Fuel Finder E10 prices. Hourly incremental collection, with a complete daily refresh, maintains a current forecourt catalogue. Closed stations and missing/invalid prices are excluded. The national series is the **unweighted arithmetic average of reporting open E10 stations**, not the government's sales-weighted national statistic. Sample composition and provider reporting errors may affect it.
- National observations are one row per UK day, updated during that day. Station observations are stored hourly only for stations tracked by at least one user; one stored observation can serve several users. The chart includes the earliest available observation within the last 30 days.
- Fuel Finder supplies current prices. Live historical daily values are never fabricated or interpolated on first startup. The first import gives one actual national point; genuine history grows with collection. The UI explicitly shows this limitation.
- A live fourteen-day incremental API probe on 16 September 2026 returned only one current version per station/fuel type, not a historical event log. See [Fuel Finder history investigation](FUEL_FINDER_HISTORY.md) for the evidence and the separately sourced DESNZ weekly-history option.
- The separate [ML research framework](ml/README.md) now trains two independent model families: official DESNZ sales-weighted weekly observations and FuelCosts equal-station daily observations. Weekly training never produces daily forecasts or interpolated daily labels. The daily archive is an observed-price proxy because historical closure status is unavailable; it does not exactly reproduce the live open-station population. The [historical data investigation](MARKET_DATA_BACKFILL.md) records archive provenance and the original quotes. The app now uses the exported fitted models; genuine source-labelled bootstrap observations are imported into dedicated model tables, separate from samples and intraday open-station averages.
- For local development, `pnpm db:seed` explicitly generates 30 days of sample national prices. `MARKET_DATA_MODE=sample` uses these alongside the stored futures/FX inputs in the same model. Samples are anchored to the latest fresh collected national price (or 171.5p/L without one), with approximately 1.1p daily rises in the last five days and smaller earlier changes. These are a UI/model exercise, not historical evidence. Samples have their own source marker, preserve existing actual observations, are labelled in the API/UI, and are always excluded in live mode. Sample mode is unavailable outside development.

### Trained forecasts and aligned observations

- The daily target is the equal-station **observed E10 proxy** at 08:00 UTC, including last known prices regardless of current closures, matching training. The separate open-station current average still supports live station comparison. Their gap is recorded when an open-station observation is available immediately before the cutoff.
- `model_pump_event` stores receipt and source-effective timestamps and explicit invalidations. Snapshot eligibility uses `max(receipt, effective)` strictly before 08:00 UTC; later stale source updates cannot replace newer source values. Genuine FuelCosts history and an observed-station baseline are bootstrapped with recorded source revisions. Existing snapshots never change on import or hourly collection.
- Final B7H/BZ statistics preserve every correction/deletion and historical definition matching. Features replay events published by the snapshot, compare the same raw contract and expiry at both ends of a return, and apply the same five-calendar-day freshness allowance as training. ECB USD/EUR divided by GBP/EUR supplies USD/GBP; rates are available no earlier than 18:00 UTC. Later known FX corrections receive their actual collection timestamp.
- The fitted daily model produces 14 direct daily predictions. Contributions are sums of standardized linear terms plus the intercept, expressed in p/L; they are not fixed percentage weights or causal explanations. Days 8–14 are an outlook only. The empirical 14-day interval achieved 56% test coverage, so no guaranteed or calibrated 90% claim is made.
- Official DESNZ weekly prices have their own series. The conservative origin is reference date plus three days at 08:00 UTC. Predictions target the next two reference dates (+7/+14 days from the observation, typically +4/+11 after Thursday issuance). Weekly predictions never enter the daily model or buying advice.
- `forecast_run` saves model version, input features and output once per origin. Later data corrections cannot rewrite an issued forecast. The bootstrap and forecasts exclude development sample rows.
- When required current futures/FX or genuine retail history are missing, the main endpoint identifies a heuristic fallback explicitly. The weekly endpoint reports unavailability instead of manufacturing observations.

### Heuristic fallback forecast

1. Anchor to the latest actual national price. Return today plus **14 future calendar days**. Reject a pump anchor more than two calendar days old; missing live inputs never silently become demo observations.
2. Estimate pump momentum from the previous five daily changes, accounting for gaps between observation dates. Clamp the mean to ±3p/L/day. The pump scenario is today's price plus momentum times forecast horizon.
3. Pump weight on day `d` is `0.9 × exp(-(d - 1) / 6) × min(1, observedChanges / 5)`. With enough history, it starts at 90% tomorrow, falling to about 10% at day 14. With only today's price, it is zero until changes have actually been observed.
4. Split remaining market weight **80% B7H / 20% Brent**. If only one valid market signal exists it receives the remaining market weight; if neither exists the unused weight holds today's price. Missing inputs lower certainty and appear in warnings/tooltips.
5. Compare the nearest unexpired contract against its own settlement about seven days earlier. Never calculate a return by comparing the old contract with the next contract on rollover. A latest settlement older than five days, or missing comparable FX/history, disables that signal.
6. Convert B7H USD/tonne into indicative GBP p/L using **0.745 kg/L assumed density**, and Brent USD/barrel using **158.987294928 litres/barrel**. Density is an approximation; these are upstream proxies, not retail pump-price quotes.
7. The pending move for each market scenario is `1.2 × GBP upstream change − pump change over the preceding week`, capped to ±20p/L. Subtracting the observed retail change reduces double counting of a move already passed through. The 1.2 factor is a modelling assumption, not a tax calculation. Without a week of actual pump history, the observed retail adjustment is unavailable and uncertainty is higher.
8. Positive moves follow `1 − exp(-d / 2)`; negative moves begin after day two and reach full pass-through at day 14. This encodes the supplied faster-rise/slower-cut research. Blend the three scenarios around today's actual pump price. No independent forecast of future oil shocks is invented.
9. Each future point includes exact rounded price, low/high bounds, input availability, per-signal weights, contributions from today's price, and source-date explanations. Bounds widen with horizon, recent pump variability and missing data. **They are illustrative uncertainty bands, not calibrated probability intervals.** Certainty is at most medium, and low beyond five days or with incomplete inputs.

### Fuel and buying advice

- UK MPG uses **4.54609 litres per imperial gallon**. Drivers choose a daily average or seven estimates in Monday–Sunday order. Weekly input is stored in full; its average is derived server-side.
- Estimate consumed fuel from the last gauge reading and the UK weekday schedule. Driving is assumed spread through the day; hourly integration handles weekday boundaries. The model is approximate around DST changes. Readings older than seven days require an update before buying advice.
- Preserve the larger of 5L or 10% of tank capacity. A small top-up must cover the actual scheduled miles to the chosen date plus reserve, rounded up to 0.1L and capped at available tank space. If a day's driving exceeds usable capacity, explicitly plan multiple stops.
- For the daily model, evaluate only dates in its first seven forecast days. Waiting requires at least 0.5p/L lower price and £1 expected saving on the fuel actually deferred; these are product thresholds, not validated probability guarantees. A rise triggers early filling only if fuel will be needed within that window and the same materiality thresholds are met. Reassess daily.
- Select only dates reachable on one tank. Tuesday/Wednesday can break a tie within 0.3p/L; do not fabricate a weekday discount. Filling to beat a rise uses available tank space. Savings compare only fuel deferred to a cheaper date and are not guaranteed.
- Nearby prices and motorway flags support station comparison; the national forecast is not a forecast for an individual forecourt.

### Collection and delivery

Cloudflare runs Databento/FX collection daily at **08:00 UTC**, and Fuel Finder at **10 minutes past each UTC hour**. A Postgres job claim permits at most one attempt per daily/hourly slot, including concurrent invocations. Completed jobs skip without contacting providers. Failures are recorded, retain previous committed data and retry in the next scheduled slot. Initial market collection backfills 35 days of the three nearest contracts; subsequent daily downloads overlap seven days to pick up delayed settlements/corrections. Downloads include available publications up to the job timestamp; feature construction applies the exact forecast cutoff. An additional bounded historical definition download ensures revisions are joined to definitions known at publication.

SMS remains a database-backed stub for phone verification. The text-alert dashboard card has been removed. Existing opt-in stub alerts and manual endpoints remain for compatibility; 07:00/08:00 UTC triggers retain evaluation at 08:00 Europe/London. New onboardings default to no alerts. No real messages are sent.

### Provider specifications used

- [Databento statistics](https://databento.com/docs/schemas-and-data-formats/statistics), [instrument definitions](https://databento.com/docs/schemas-and-data-formats/instrument-definitions), [historical API](https://databento.com/docs/api-reference-historical)
- [Fuel Finder public API](https://www.developer.fuel-finder.service.gov.uk/fuel-finder/apis-ifr/info-recipent), [token endpoint](https://www.developer.fuel-finder.service.gov.uk/fuel-finder/apis-ifr/access-token), [rate limits](https://www.developer.fuel-finder.service.gov.uk/fuel-finder/dev-guideline)
- [Frankfurter daily exchange rates](https://frankfurter.dev/)

At 08:05 UTC a scheduled job freezes the daily snapshot, refreshes the official weekly source and materialises both forecasts. The weekly output remains fixed to its trained reference-date origin.
