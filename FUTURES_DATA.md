# Futures data for Pump Hawk

Researched: 16 September 2026.

## Current decision

Databento is the selected provider to pursue. The exact proposed package, GNO-first refinement for E10, fields, dates and unsent enquiry are in [DATABENTO_REQUEST.md](DATABENTO_REQUEST.md). Coverage and commercial permissions still need confirmation. The comparison below records the research preceding that decision.

A later authorised [direct API test](DATABENTO_TEST.md) succeeded: B7H returned final settlements for 15 September 2026, while GNO returned none. Use this observed result when choosing the next historical sample.

## Original recommendation

Compare **CME DataMine settlement files with an agreed derived-data licence** against **Barchart OnDemand under a commercial agreement**. Evaluate **Databento historical downloads** for inexpensive research and as a possible delivery alternative once the app's rights and contract coverage are confirmed.

I found documented commercial licensing routes, but no verified free, standard subscription that already authorises the complete Pump Hawk use case. None of the providers has approved Pump Hawk specifically or supplied a quote. This research used public documentation; no vendor was contacted.

The intended use is to store daily European petrol futures observations, combine them with GBP exchange rates and UK forecourt prices, and publish petrol-price forecasts and personalised refuelling recommendations through the app and SMS. A proposed initial scope would publish our forecasts and advice while keeping the underlying futures quotes internal. The vendor must explicitly approve that scope: withholding raw quotes does not itself establish permission.

Manual downloads can simplify delivery. The licence still needs to cover processing, storage and the outputs customers receive.

## Shortlist

| Provider                                 | Data and delivery                                                                                                        | Licensing evidence                                                                                                                                                                      | Cost and unresolved details                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CME DataMine + Derived Data Services** | Official futures settlements; ongoing subscriptions or historical purchases; file browser, SFTP and API delivery routes. | CME publishes an agreement supporting creation and customer distribution of specifically agreed derived products. This is the clearest documented route for the NYMEX Eurobob contract. | Request a combined data-access and app-use quote. Final B7H settlement coverage, history and delivery schedule must be specified.                                                                   |
| **Barchart OnDemand**                    | Commercial end-of-day futures APIs and historical series.                                                                | Markets its service for websites and applications; a commercial agreement must cover our processing and forecasts. Ordinary Barchart website/Premier access is insufficient.            | Quote based on queries and fields. Exact B7H outright coverage, settlement completeness and exchange/derived-data charges remain unconfirmed.                                                       |
| **Databento**                            | CME/NYMEX and ICE datasets, historical CSV/JSON downloads and APIs.                                                      | Provides historical access and passes through venue restrictions. Historical access is not blanket permission for external derived products.                                            | Historical downloads are usage-priced with no required subscription; $125 introductory historical-data credits are advertised. Total production licensing cost and B7H coverage remain unconfirmed. |

### 1. CME: strongest documented licensing route

[DataMine](https://www.cmegroup.com/datamine.html) lists settlement data and both one-off historical orders and ongoing subscriptions. Its file-browser option suits manual ingestion, subject to the selected product's delivery options.

The [Derived Data License Agreement](https://www.cmegroup.com/market-data/files/cme-derived-data-license-agreement.pdf), clauses 2.1 and 2.6, provides for developing agreed products and, with CME's written consent, distributing those products to customers. It requires a separate valid information-access agreement. App outputs and distribution channels therefore need to be included in the agreed scope.

The [2026 derived-data fee schedule](https://www.cmegroup.com/market-data/files/2026-derived-data-fees.pdf) says unlisted uses are priced on request and CME determines whether an additional derived-data agreement is required. It also includes historical data in its scope. Do not apply its published financial-index or CFD fees to Pump Hawk without a classification from CME.

Contacts published by CME:

- Data access: `CMEDataSales@cmegroup.com` ([DataMine](https://www.cmegroup.com/datamine.html)).
- App-use classification: `CMEGroupDerivedData@cmegroup.com` ([Derived Data Services](https://www.cmegroup.com/market-data/browse-data/derived-data.html)).

### 2. Barchart: commercial service candidate

Barchart documents an [end-of-day futures API](https://www.barchart.com/ondemand/futures-end-of-day-data-api), [application-oriented data coverage](https://www.barchart.com/ondemand/data) and [historical/settlement behaviour](https://www.barchart.com/ondemand/faq). Its quote is based on requested fields and monthly query volume.

The [public-site terms](https://www.barchart.com/terms) restrict commercial and derivative use of the website's market data. A Premier subscription or downloaded website CSV should not be treated as the commercial agreement needed here. Request OnDemand/Market Data Solutions terms covering Pump Hawk and confirmation of any separate exchange permissions.

Public search results established related Eurobob spread products, but did not establish a complete, current series for the B7H outright. Coverage needs a sample: a gasoline-versus-crude spread cannot be substituted for the outright gasoline price.

### 3. Databento: promising research economics, production rights unresolved

[Pricing](https://databento.com/pricing) offers metered historical downloads, CSV/JSON output and $125 in introductory historical credits, expiring after six months. No exact download estimate was obtained for our instruments. The live-plan headline prices are not quotes for Pump Hawk's commercial use.

Its [licensing guide](https://databento.com/blog/introduction-market-data-licensing) distinguishes historical access from redistribution rights and lists exceptions. Its general statement about redistribution after 24 hours must be checked against the specific dataset. For CME data, the exchange's [derived-data terms](https://www.cmegroup.com/market-data/files/2026-derived-data-fees.pdf) still require use-case classification.

There is also a coverage detail: Databento's [CME statistics documentation](https://databento.com/docs/venues-and-datasets) says the MDP feed does not publish settlements for instruments without open interest or volume. A broad claim to cover NYMEX therefore does not prove that every Eurobob monthly settlement will be available. Request final settlement samples, including quiet trading days, before choosing this delivery route.

## Other options checked

- **ICE direct:** [CSV end-of-day subscriptions](https://www.ice.com/marketdata/reports/159) and [settlement/volume/open-interest files](https://www.ice.com/publicdocs/futures/ICE_Futures_Data_MFT_User_Guide.pdf) are available. However, the published [S2F EOD site agreement](https://www.ice.com/publicdocs/ICE_Data_EOD_Site_License.pdf), clause 3, limits processing and derived outputs to authorised internal use. Customer forecasts need a separately agreed scope. The publicly available agreement is dated 2020; obtain current terms and pricing. This remains a possible alternative venue, rather than a confirmed standard licence for the app.
- **EODData:** has a genuine [commercial feed offering](https://www.eoddata.com/products/DataFeed.aspx), including email, HTTP and FTP. Its [regular memberships](https://www.eoddata.com/products/Default.aspx) are personal-only. Commercial pricing depends on the exchanges; the site’s stock-feed price examples are not petrol-futures quotes. Eurobob coverage and actual settlement fields were not verified, so it ranks below the shortlist.
- **EODHD:** offers [commercial agreements](https://eodhd.com/financial-apis/commercial-vs-personal-license-use), but its [coverage guide](https://eodhd.com/financial-apis/quick-start-with-our-financial-data-apis) did not establish the required Eurobob futures dataset. A commercial licence alone is insufficient if the instrument is absent.

## Smallest useful data request

Proposed initial scope for comparable quotes:

- NYMEX **B7H/7H**, Gasoline Euro-bob Oxy NWE Barges (Argus) Futures, or an explicitly identified equivalent European gasoline outright.
- Current and next two contract months, with 24 months of history across successive expiries.
- Once-daily settlement, contract month, currency/unit, trade date, publication time, settlement status, volume and open interest where available.
- Quote both end-of-day delivery and an alternative using data first accessed at least 24 hours after publication.
- Manual file download/CSV acceptable; automated access optional.
- Rights to store history, calibrate and test the model, run calculations on Cloudflare, and provide forecasts and personalised recommendations through the website, its frontend API and SMS.
- Explicit treatment of raw data display, derived outputs, attribution, retention after cancellation and any exchange or benchmark-provider charges.

The [B7H rules](https://www.cmegroup.com/rulebook/NYMEX/7/729.pdf) specify USD per metric tonne and cash settlement against the contract month's average Argus assessments. Keep each actual contract month identifiable; it is not an observation of today's UK wholesale petrol cost. Request the exact vendor symbol mapping.

## Ready-to-send enquiry

**Subject: Small commercial licence for European petrol futures — UK consumer app**

We are building Pump Hawk, a consumer web app for UK drivers. It combines market indicators, GBP exchange rates and UK forecourt prices to estimate future pump prices and advise users when to refuel and how many litres to buy. Recommendations appear in the app and by SMS.

Please quote your smallest suitable package for daily settlements for NYMEX B7H/7H Eurobob gasoline futures, or a clearly identified equivalent European gasoline outright, covering the current and next two months plus 24 months of history. Manual file downloads or CSV are acceptable. Please also price an option where observations are first accessed at least 24 hours after publication.

Our proposed initial customer outputs are our own pump-price forecasts and personalised refuelling recommendations. Please confirm permission to store the underlying observations, calibrate/backtest a model, perform calculations in a hosted cloud service and distribute those outputs via the website, its frontend API and SMS. Please identify any separate exchange or benchmark-provider agreement required, including derived-data rights, and include all mandatory fees, minimum terms, attribution and retention conditions.

Please provide a small sample showing contract identifiers, final settlements, publication timestamps, units and handling of days without trades. We would also appreciate any startup pricing available for this narrow consumer use case.

## Effect on the app

No futures provider has been integrated. Before implementation, record the agreed provider, permitted use and input-delay rules. Keep publication time separate from ingestion time, and store actual contract months and settlement status. The forecasting logic in PRICES.md will need an explicit distinction between observed wholesale prices and futures-based indicators, followed by validation against UK retail history.
