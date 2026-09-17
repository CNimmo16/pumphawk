# Databento data specification for Pump Hawk

Prepared: 16 September 2026. The vendor enquiry below remains unsent. A subsequently authorised **direct API test has now succeeded**; see [DATABENTO_TEST.md](DATABENTO_TEST.md). On 15 September, GNO returned no settlements and B7H returned final settlements, so B7H is the practical candidate for the next coverage test.

## Original proposed package

Request **daily official settlements for NYMEX GNO Eurobob non-oxy gasoline futures**, using Databento **GLBX.MDP3**, with **statistics** and **definition** data. Start with 24 months of history and ongoing daily updates for the current delivery month and the next two months. Manual CSV downloads are acceptable.

This specification was prepared from public documentation before the API test. GNO and B7H identifiers and one-day download costs have now been checked through the account; longer-term completeness and Pump Hawk's commercial permissions remain unverified. Preserve the findings in the test note when refining this package.

## 1. Instruments and identifiers

| Priority                                 | Exact exchange product                                     | Product code                | Proposed Databento parent |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------- | ------------------------- |
| Primary                                  | Gasoline Eurobob Non-Oxy NWE Barges (Argus) Futures, NYMEX | `GNO`                       | `GNO.FUT`                 |
| Separately priced comparison or fallback | Gasoline Euro-bob Oxy NWE Barges (Argus) Futures, NYMEX    | Globex `B7H`; clearing `7H` | `B7H.FUT`                 |

**Why GNO first:** Argus identifies non-oxy as the blendstock used to make E10, and oxy as the blendstock for E5. That makes non-oxy the closer product match for our UK E10 model; whether it predicts prices better still needs testing. This refines the earlier B7H-first shortlist. [Argus E10 explanation](https://view.argusmedia.com/rs/584-BUW-606/images/FAQ%20-%20Argus%20Eurobob%20transition%20to%20E10.pdf)

CME's [GNO launch notice](https://www.cmegroup.com/notices/electronic-trading/2018/08/20180820.html) explicitly identifies `GNO` as its MDP asset code. Its [B7H listing notice](https://www.cmegroup.com/notices/electronic-trading/2025/01/20250120.html) identifies `B7H`. The parent strings above follow Databento's documented `[asset].FUT` convention; they have not been resolved against an account. Parent requests include futures spreads, so select outright futures using `instrument_class = F` and the actual delivery month. Preserve the dated mappings to `instrument_id` and `raw_symbol`. [Databento symbology](https://databento.com/docs/standards-and-conventions/symbology)

GNO is a cash-settled monthly-average contract quoted in **USD per metric tonne**, with a **1,000-tonne contract size**. Its expiry settlement references the month's Argus non-oxy assessments. Request daily settlement observations for these monthly contracts, not just their final expiry settlements. [GNO rules](https://www.cmegroup.com/rulebook/NYMEX/10/1027.pdf)

The initial scope excludes options, calendar spreads, gasoline/crude crack spreads, BALMO contracts, US RBOB, Brent, diesel and additional exchanges. B7H is an optional separate line item, not a required second subscription.

## 2. Dates and contract coverage

| Item             | Requested scope                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage sample  | Trading/reference dates **1 August–11 September 2026**, inclusive; enough to inspect a month change and quiet sessions.                                                                                         |
| Main backfill    | **1 September 2024–31 August 2026**, inclusive: 24 complete calendar months.                                                                                                                                    |
| Warm-up          | August 2024 observations for the initial contracts, to calculate changes before the first backtest date.                                                                                                        |
| Current top-up   | From **1 September 2026** through the latest observation eligible under the selected access delay.                                                                                                              |
| Daily curve      | Current delivery month while active, plus the next two calendar delivery months. For September 2026: **September, October and November 2026**.                                                                  |
| Historical curve | The same rolling delivery-month selection on each historical date, including expired contracts. Include at least 15 preceding trading days for each newly entering contract so comparisons use the same expiry. |
| Frequency        | One ingestion each day; retain all source revisions within each downloaded interval.                                                                                                                            |

These are **reference-date requirements**, not literal UTC API start/end parameters. Include later-published records and corrections referring to the requested dates. Confirm the required publication-time buffer with Databento.

Keep individual contract histories. A continuous front-month series alone cannot distinguish a genuine market move from the change in price when the selected contract rolls. Monthly curve levels are model inputs, not 30 daily pump-price predictions supplied by Databento.

## 3. Schemas and fields

### `statistics`

Required statistic types:

| `stat_type`            | Use                                |
| ---------------------- | ---------------------------------- |
| `3` — settlement price | Primary daily price observation.   |
| `6` — cleared volume   | Activity and quality assessment.   |
| `9` — open interest    | Coverage and liquidity assessment. |

Retain the native fields:

```text
ts_recv, ts_event, ts_ref, publisher_id, instrument_id,
price, quantity, sequence, ts_in_delta, channel_id,
stat_type, update_action, stat_flags
```

Store all revisions, including preliminary records and deletes. Preserve nulls. Native integer prices use a 1e-9 scale; a decimal CSV export must document whether that conversion is already applied. These are venue-issued statistics. An `ohlcv-1d` candle close is not an equivalent settlement observation. [Statistics schema](https://databento.com/docs/schemas-and-data-formats/statistics)

### `definition`

Request point-in-time definitions and symbol mappings covering the same instruments and dates. Preserve full records; these fields drive our importer:

```text
ts_recv, ts_event, publisher_id, instrument_id, raw_symbol,
security_update_action, asset, exchange, security_type,
instrument_class, leg_count, currency, settl_currency,
unit_of_measure, unit_of_measure_qty, maturity_year, maturity_month,
activation, expiration, min_price_increment, display_factor
```

They identify the contract, delivery month, price units and validity period. Validate price units against the exchange specification; do not multiply the quoted per-tonne price by the contract's 1,000-tonne size when building the indicator. [Definition schema](https://databento.com/docs/schemas-and-data-formats/instrument-definitions)

These field lists describe what to preserve, not a claim that Databento supports filtering fields or statistic types server-side. We can receive the complete schemas and filter locally.

### CME-specific interpretation

Use `ts_ref` as the trading/reference date without converting it to London time. Select the latest applicable final end-of-day settlement available at the forecast cutoff: `stat_flags & 1` means final, `& 2` indicates actual rather than theoretical, and `& 8` marks intraday. Retain quality flags rather than silently treating theoretical values as trades. Volume and open interest can arrive after the price, including on Sunday for Friday. [CME feed documentation](https://databento.com/docs/venues-and-datasets/glbx-mdp3)

## 4. Delivery and access delay

Ask for two separately costed delivery options:

1. **Budget option:** historical downloads, with first access only after each record is at least 24 hours old. Manual CSV is sufficient.
2. **Fresher option:** access to the latest completed session's settlements before our **08:00 Europe/London** recommendation run. Ask which subscription and permissions support this; do not assume that “yesterday” means 24 hours old.

Databento distinguishes historical access from intraday/delayed access, and notes exceptions for redistribution. The budget option is a candidate to quote, not a confirmed production licence. [Access-delay guidance](https://databento.com/blog/introduction-market-data-licensing)

CSV should include symbol mappings, full timestamps, documented decimal precision and explicit nulls. Keep the original files for reproducibility. A parent-level portal download may include more expiries and spreads than our target: Databento documents that its portal selects parent products, while individual-contract batch selection uses its API. Ask for the cost difference between these approaches. [Futures download conventions](https://databento.com/docs/examples/futures/futures-introduction/special-conventions-for-futures-on-databento)

Daily data supports a daily decision cycle. The 24-hour option cannot support an immediate alert about a new intraday supply shock; its extra delay may also consume much of the assumed 24–48-hour retail response window.

## 5. Coverage and commercial questions to include

### Coverage

Databento says CME's MDP feed omits settlements for instruments without open interest or volume. Ask for **GNO settlement availability by date and expiry**, missing-session counts, and the split between final/preliminary and actual/theoretical observations. Confirm coverage of quiet days and expired contracts. [CME feed limitation](https://databento.com/docs/venues-and-datasets/glbx-mdp3)

If GNO is too sparse, ask whether B7H is demonstrably more complete and quote it separately. Do not fill absent observations with zero or present old observations as new. A generic claim of NYMEX coverage does not settle this question.

### Commercial use and quote

Describe Pump Hawk as a commercial UK consumer app, with potentially free and paid users. Request permission for:

- Storage, model calibration and backtesting, and server-side calculations on Cloudflare with Postgres storage.
- Distribution of our own estimated UK pump prices, trend charts and personalised refuelling recommendations through the website, its frontend API and SMS.
- Keeping source futures quotes internal under the proposed initial scope; separately clarify any permitted display of source values or percentage changes.
- Retention of source history and model outputs after cancellation, required attribution, and service-provider access.

Ask Databento to identify any CME derived-data or Argus-related agreement needed for this exact use, plus all mandatory fees and minimum terms. CME's published fee schedule includes historical information and requires a quote for unlisted derived uses; withholding raw prices alone does not establish permission. [CME derived-data terms](https://www.cmegroup.com/market-data/files/2026-derived-data-fees.pdf)

Request separate costs for the backfill, recurring daily delivery, and commercial rights. Databento advertises metered historical access, but we have not obtained an instrument-specific estimate. [Databento pricing](https://databento.com/pricing)

## 6. How this will fit the app

Implementation is deferred. Review these points alongside [PRICES.md](PRICES.md) before replacing the synthetic provider:

- **Keep futures distinct from observed wholesale costs.** Store the source price in USD/tonne and derive GBP/tonne using a separately sourced daily spot rate: `GBP per tonne = USD per tonne / USD per GBP`. Match the information available at the prediction time and apply currency effects once.
- **Calibrate against actual UK petrol prices.** Futures do not include the complete UK retail cost structure. Use GBP price changes and curve information as explanatory inputs; estimate the retail relationship from history. Converting to pence/litre additionally requires an explicit density assumption. Do not put a USD/tonne figure into `wholesalePence`.
- **Account for monthly averaging.** The current delivery month's value partly reflects days already elapsed. The next month's contract is a cleaner forward-period input, but neither is a direct forecast of next Tuesday's forecourt price.
- **Handle calendars and ageing explicitly.** The current model requires contiguous calendar-day observations and rejects data older than two calendar days. It needs exchange-session-aware freshness and separate timestamps for futures, FX and retail observations. Carried-forward weekend values must not count as fresh market observations.
- **Prevent artificial signals.** Calculate changes for the same expiry or use an explicitly documented roll-adjustment method. Backtests must only use records available by each historical cutoff, respecting the proposed access delay and later corrections.
- **Match customer fields to agreed rights.** The current API and dashboard expose `wholesalePence`, including in history. Those fields need redesign if the agreed licence covers only our forecasts and recommendations.

Separate data still needed: actual UK retail petrol observations and their history, GBP/USD spot rates, and any independently sourced disruption signal. They are outside this Databento order.

## Draft covering message — not sent

**Subject: GNO Eurobob daily settlements — coverage and commercial-use quote for Pump Hawk**

We are building Pump Hawk, a web app advising UK drivers when to refuel and how much fuel to buy. We would like to use Databento as our futures-data provider.

Please confirm the attached specification for NYMEX GNO Eurobob non-oxy gasoline futures in GLBX.MDP3, with statistics and definition records, a rolling three-month delivery curve, and the history and sample dates specified above. Our required daily values are official settlements, cleared volume and open interest, with contract identifiers, reference dates, publication timestamps and quality/revision flags.

Please confirm actual settlement completeness and symbol mappings for these contracts, especially on quiet sessions. If GNO coverage is insufficient, please assess B7H separately.

Please quote the historical backfill and ongoing daily delivery, comparing manual downloads first accessed after 24 hours with latest-session settlement access before 08:00 London time. Please also confirm the commercial permissions and total mandatory costs for storing and processing the data and distributing our own petrol-price forecasts and refuelling recommendations through our website, frontend API and SMS. Our proposed initial scope keeps underlying futures quotes internal.

This is a request for coverage, delivery and licensing information; please identify any additional exchange or benchmark-provider agreements required.
