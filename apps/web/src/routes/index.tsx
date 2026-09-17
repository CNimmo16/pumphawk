import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardOptions,
  getDriverOptions,
  getForecastOptions,
  getTrackedStationsOptions,
} from "@pump-hawk/openapi/react-query";
import type { Driver, Recommendation } from "@pump-hawk/openapi/types";
import {
  ArrowRight,
  ArrowUp,
  CarFront,
  Clock3,
  Info,
  Leaf,
  LogOut,
  Settings2,
  TrendingDown,
  TrendingUp,
  MapPin,
} from "lucide-react";
import { auth, dateLabel, errorMessage } from "../lib/api";
import { AuthForm } from "../components/auth-form";
import { DriverForm, TankForm } from "../components/driver-form";
import { Modal } from "../components/modal";
import { PriceChart, StationChart } from "../components/price-chart";
export const Route = createFileRoute("/")({ component: Dashboard });
function HawkLogo() {
  return (
    <svg
      viewBox="0 0 38 38"
      width="37"
      height="37"
      fill="none"
      aria-hidden="true"
    >
      <rect width="38" height="38" rx="11" fill="#244d3a" />
      <path d="M7 11l12 5 12-5-5 10-7 8-7-8z" fill="#d5ef9b" />
      <path d="M12 17l7 3 7-3-7 9z" fill="#244d3a" />
      <path d="M18 17h4l-3 5z" fill="#fff" />
    </svg>
  );
}

function FillUpForecastSkeleton() {
  return (
    <section
      className="advice-card"
      role="status"
      aria-label="Loading your fill-up forecast"
      aria-busy="true"
    >
      <div aria-hidden="true">
        <div className="advice-top">
          <span className="pill">
            <Leaf size={13} />
            YOUR FILL-UP FORECAST
          </span>
        </div>
        <div className="advice-content">
          <div className="advice-skeleton-copy">
            <span className="advice-skeleton advice-skeleton-title" />
            <span className="advice-skeleton" />
            <span className="advice-skeleton advice-skeleton-short" />
          </div>
          <div className="advice-icon advice-skeleton" />
        </div>
        <div className="advice-bottom">
          {[0, 1, 2].map((stat) => (
            <div key={stat}>
              <span className="advice-skeleton advice-skeleton-short" />
              <span className="advice-skeleton advice-skeleton-value" />
              <span className="advice-skeleton" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TankCard({
  car,
  advice,
  onEdit,
  onTank,
}: {
  car: Driver;
  advice?: Recommendation | null;
  onEdit: () => void;
  onTank: () => void;
}) {
  const litres = advice?.estimatedCurrentLitres ?? car.currentLitres,
    reserve =
      advice?.reserveLitres ?? Math.max(5, car.tankCapacityLitres * 0.1);
  return (
    <section className="card tank-card">
      <div className="section-heading">
        <h2>Your tank</h2>
        <button
          className="icon-button"
          aria-label="Edit car and stations"
          onClick={onEdit}
        >
          <Settings2 size={18} />
        </button>
      </div>
      <div className="vehicle">
        <div className="vehicle-icon">
          <CarFront size={27} strokeWidth={1.5} />
        </div>
        <div>
          <strong>{car.vehicleName}</strong>
          <span>
            {car.tankCapacityLitres}L tank · {car.mpg} UK MPG
          </span>
        </div>
      </div>
      <div className="tank-level">
        <strong>
          {Math.round((litres / car.tankCapacityLitres) * 100)}
          <span>%</span>
        </strong>
        <span>
          {litres.toFixed(1)} / {car.tankCapacityLitres} litres
        </span>
      </div>
      <div className="tank-track">
        <div style={{ width: `${(litres / car.tankCapacityLitres) * 100}%` }} />
        <i style={{ left: `${(reserve / car.tankCapacityLitres) * 100}%` }} />
      </div>
      <div className="tank-labels">
        <span>E</span>
        <span>F</span>
      </div>
      <div className="fuel-days">
        <Clock3 size={16} />
        <span>
          {advice?.daysOfFuel != null ? (
            <>
              About <strong>{advice.daysOfFuel} days</strong> of driving
            </>
          ) : advice ? (
            "No daily driving set"
          ) : (
            "Last reported gauge reading"
          )}
        </span>
      </div>
      <p className="fine-print">
        {car.mileageMode === "weekly"
          ? "Using your weekly driving schedule"
          : `Based on ${car.dailyMiles.toFixed(1)} miles a day`}
        . Keep {reserve.toFixed(1)}L in reserve.
      </p>
      <button className="button outline full" onClick={onTank}>
        Update tank level
        <ArrowRight size={15} />
      </button>
    </section>
  );
}
function Dashboard() {
  const [ready, setReady] = useState(false),
    [modal, setModal] = useState<"auth" | "driver" | "tank" | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => setReady(true), []);
  const session = auth.useSession(),
    signedIn = !!session.data?.user,
    cache = useQueryClient();
  const national = useQuery({
    ...getForecastOptions(),
    enabled: ready,
    staleTime: 60000,
    refetchInterval: 3600000,
    retry: 1,
  });
  const driver = useQuery({
    ...getDriverOptions(),
    enabled: ready && signedIn,
    retry: false,
  });
  const personal = useQuery({
    ...getDashboardOptions(),
    refetchInterval: 3600000,
    enabled: ready && signedIn && !!driver.data,
    retry: 1,
  });
  const tracked = useQuery({
    ...getTrackedStationsOptions(),
    enabled: ready && signedIn,
    refetchInterval: 3600000,
  });
  const forecast = signedIn
      ? (personal.data?.forecast ?? national.data)
      : national.data,
    advice = signedIn ? personal.data?.recommendation : undefined,
    car = signedIn ? (personal.data?.driver ?? driver.data) : undefined;
  const missing =
    signedIn &&
    driver.isError &&
    typeof driver.error === "object" &&
    driver.error !== null &&
    "error" in driver.error &&
    driver.error.error.code === "DRIVER_NOT_FOUND";
  const onboarding =
    signedIn && (missing || (!!driver.data && !driver.data.onboardingComplete));
  const failure = signedIn && ((!missing && driver.error) || personal.error);
  const loadingAdvice =
    !ready ||
    session.isPending ||
    (signedIn && (driver.isPending || (!!driver.data && personal.isPending)));
  const configure = () => setModal(signedIn ? "driver" : "auth");
  async function signOut() {
    const result = await auth.signOut();
    if (result.error) {
      setNotice(errorMessage(result.error));
      return;
    }
    cache.clear();
    setModal(null);
    setNotice("You’re signed out. Your settings are saved.");
  }
  return (
    <>
      <div className="top-rule" />
      <header className="site-header">
        <a className="brand" href="/" aria-label="Pump Hawk home">
          <HawkLogo />
          <span>
            pump<span className="brand-light">hawk</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#overview" className="nav-active">
            Overview
          </a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="header-actions">
          <span className="uk-label">UK · E10 PETROL</span>
          {signedIn ? (
            <button
              className="icon-button"
              onClick={() => void signOut()}
              aria-label="Sign out"
            >
              <LogOut size={19} />
            </button>
          ) : (
            <button
              className="button small outline"
              onClick={() => setModal("auth")}
            >
              Sign in
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>
      <main id="overview">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="status-dot" />A LITTLE FORESIGHT. A FULLER TANK.
            </div>
            <h1>
              Stay a step ahead
              <br className="mobile-break" /> of the pump.
            </h1>
            <p>Know when to fill up. Keep a little more in your pocket.</p>
          </div>
          <div className="date-chip">
            <Clock3 size={15} />
            {forecast
              ? `Prices as of ${dateLabel(forecast.asOf)}`
              : "Your petrol outlook"}
          </div>
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button className="text-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {forecast?.mode === "demo" && (
          <div className="demo-notice">
            <Info size={15} />
            <strong>Demo data</strong>These prices are synthetic examples.
          </div>
        )}
        {forecast?.mode === "sample" && (
          <div className="demo-notice" role="status">
            <Info size={15} />
            <strong>Local sample history</strong>
            Forecasts and fill-up advice include seeded pump prices. Station
            prices and market feeds are unchanged.
          </div>
        )}
        {onboarding ? (
          <section className="card onboarding-panel">
            <DriverForm
              driver={driver.data}
              onDone={() =>
                setNotice("Your car, driving schedule and stations are saved.")
              }
            />
          </section>
        ) : failure ? (
          <section className="onboarding-card" role="alert">
            <Info />
            <h2>Your dashboard is taking a pit stop.</h2>
            <p>{errorMessage(failure)}</p>
            <button
              className="button dark"
              onClick={() => void cache.invalidateQueries()}
            >
              Try again
            </button>
          </section>
        ) : (
          <div className="dashboard-grid">
            <div className="main-column">
              {loadingAdvice ? (
                <FillUpForecastSkeleton />
              ) : (
                <section
                  className={`advice-card ${advice?.action === "fill-now" ? "rise" : ""}`}
                >
                  <div className="advice-top">
                    <span className="pill">
                      <Leaf size={13} />
                      YOUR FILL-UP FORECAST
                    </span>
                    <span className="scenario-label">
                      {signedIn ? "YOUR PLAN" : "MADE FOR YOUR JOURNEYS"}
                    </span>
                  </div>
                  <div className="advice-content">
                    <div>
                      <h2>
                        {advice?.title ??
                          (signedIn
                            ? "Checking the road ahead."
                            : "Your next fill-up, a little smarter.")}
                      </h2>
                      <p>
                        {advice?.reason ??
                          (signedIn
                            ? (personal.data?.forecastError ??
                              "We’re gathering your fuel and price data.")
                            : "Tell us about your car and usual driving. We’ll work out when to stop and how much to buy.")}
                      </p>
                    </div>
                    <div className="advice-icon">
                      {advice?.action === "fill-now" ? (
                        <TrendingUp size={52} strokeWidth={1.4} />
                      ) : (
                        <TrendingDown size={52} strokeWidth={1.4} />
                      )}
                    </div>
                  </div>
                  {advice ? (
                    <div className="advice-bottom">
                      <div>
                        <span className="stat-caption">BUY NOW</span>
                        <strong>
                          {advice.litresToBuy.toFixed(1)}
                          <small> litres</small>
                        </strong>
                        <span className="stat-note">
                          {advice.litresToBuy
                            ? `About £${advice.estimatedCostGbp.toFixed(2)}`
                            : advice.action === "update-tank"
                              ? "Confirm your gauge first"
                              : "Nothing to buy today"}
                        </span>
                      </div>
                      <div>
                        <span className="stat-caption">REASSESS ON</span>
                        <strong>{dateLabel(advice.nextFillDate)}</strong>
                        <span className="stat-note">
                          Check prices before you fill
                        </span>
                      </div>
                      <div className="saving-stat">
                        <span className="stat-caption">ESTIMATED SAVING</span>
                        <strong>
                          £{advice.estimatedSavingsGbp.toFixed(2)}
                        </strong>
                        <span className="stat-note">
                          On fuel you defer buying
                        </span>
                      </div>
                    </div>
                  ) : (
                    !signedIn && (
                      <button className="button dark" onClick={configure}>
                        Make it yours
                        <ArrowRight size={16} />
                      </button>
                    )
                  )}
                </section>
              )}
              <section className="card forecast-card" id="forecast">
                <div className="section-heading">
                  <div>
                    <h2>The road ahead</h2>
                    <p>UK E10 petrol · 14 days back, 14 days ahead</p>
                  </div>
                  <span className="period-pill">UK outlook</span>
                </div>
                {forecast ? (
                  <>
                    <PriceChart forecast={forecast} />
                    <div className="chart-note">
                      <Info size={14} />
                      <span>
                        {forecast.mode === "sample"
                          ? "Includes synthetic local pump history. "
                          : "Fuel Finder reporting-station average. "}
                        Shading shows an illustrative uncertainty range.
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="chart-empty" role="status">
                    {national.error
                      ? errorMessage(national.error)
                      : "Loading the latest national prices…"}
                  </div>
                )}
              </section>
              <section className="card forecast-card">
                <div className="section-heading">
                  <div>
                    <h2>Your regular stops</h2>
                    <p>Actual E10 prices · collected hourly</p>
                  </div>
                  {signedIn && (
                    <button className="text-button" onClick={configure}>
                      Edit stations
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
                {signedIn ? (
                  tracked.data ? (
                    <StationChart data={tracked.data} />
                  ) : (
                    <p className="chart-empty">
                      {tracked.error
                        ? errorMessage(tracked.error)
                        : "Loading your stations…"}
                    </p>
                  )
                ) : (
                  <div className="chart-empty">
                    <MapPin size={24} />
                    <p>Track up to three stations near you.</p>
                    <button className="text-button" onClick={configure}>
                      Choose my stations
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>
            </div>
            <aside className="side-column">
              {car ? (
                <TankCard
                  car={car}
                  advice={advice}
                  onEdit={configure}
                  onTank={() => setModal("tank")}
                />
              ) : (
                <section className="card tank-card">
                  <h2>Your tank</h2>
                  <div className="chart-empty">
                    <CarFront size={35} />
                    <p>A fill-up plan that fits your car.</p>
                    <button className="button outline full" onClick={configure}>
                      Add your car
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              )}
              <section className="card source-card">
                <div className="eyebrow">THE SIGNALS WE WATCH</div>
                <h2>Behind the forecast</h2>
                <div>
                  <span>At the pump</span>
                  <strong>
                    {forecast
                      ? `${forecast.currentPricePence.toFixed(2)}p/L`
                      : "Awaiting prices"}
                  </strong>
                  <p>
                    {forecast?.history.at(-1)?.source === "sample"
                      ? "Seeded local E10 example"
                      : "Latest Fuel Finder E10 average"}
                  </p>
                </div>
                <div>
                  <span>Upstream</span>
                  <strong>B7H petrol + Brent crude</strong>
                  <p>Daily settlements, converted to GBP</p>
                </div>
                <div>
                  <span>Your local view</span>
                  <strong>
                    {signedIn ? (tracked.data?.stations.length ?? 0) : 0}{" "}
                    stations tracked
                  </strong>
                  <p>Fresh observations every hour</p>
                </div>
              </section>
            </aside>
          </div>
        )}
        <section className="how-section" id="how-it-works">
          <div>
            <div className="eyebrow">A SMARTER WAY TO FILL UP</div>
            <h2>
              Watch the wholesale.
              <br />
              Beat the lag.
            </h2>
            <p>
              What happens before petrol reaches the forecourt gives you a
              little room to plan.
            </p>
          </div>
          <div className="how-steps">
            <article>
              <span>01</span>
              <div>
                <h3>Start at the pump</h3>
                <p>
                  Recent price changes carry the most weight over the next few
                  days.
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>Look further upstream</h3>
                <p>
                  B7H petrol and Brent crude in pounds shape the longer outlook.
                  Rises typically arrive faster than cuts.
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>Make the right-sized stop</h3>
                <p>
                  Your tank and weekday driving schedule help decide whether to
                  fill, top up or wait.
                </p>
              </div>
            </article>
          </div>
        </section>
        <details className="methodology">
          <summary>
            About the forecast and data sources
            <ArrowRight size={15} />
          </summary>
          <p>
            {forecast?.methodology ??
              "The 14-day forecast combines actual E10 pump prices with GBP-converted petrol and crude futures. The model is a guide based on PRICES.md, with policy weights that have not yet been fitted or backtested."}
          </p>
          {forecast?.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p>
            Station history begins when collection starts, up to a maximum of 30
            days. National averages aren’t quotes for an individual forecourt.
            Confirm your gauge regularly; fuel estimates depend on your stated
            driving.
          </p>
          <p>
            Sources:{" "}
            <a href="https://www.gov.uk/guidance/access-the-latest-fuel-prices-and-forecourt-data-via-api-or-email">
              GOV.UK Fuel Finder
            </a>{" "}
            (Open Government Licence),{" "}
            <a href="https://databento.com/">Databento CME</a>, and{" "}
            <a href="https://frankfurter.dev/">ECB rates via Frankfurter</a>.
          </p>
        </details>
        <footer>
          <a className="brand footer-brand" href="#overview">
            <HawkLogo />
            <span>pumphawk.</span>
          </a>
          <span>A little foresight goes a long way.</span>
          <div>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API docs ↗
            </a>
            <a href="#overview" aria-label="Back to top">
              <ArrowUp size={17} />
            </a>
          </div>
        </footer>
      </main>
      {modal && (
        <Modal
          title={
            modal === "auth"
              ? "Welcome to Pump Hawk"
              : modal === "tank"
                ? "Update your tank"
                : "Your car, your journey"
          }
          onClose={() => setModal(null)}
        >
          {modal === "auth" ? (
            <AuthForm
              onDone={() => {
                void cache.invalidateQueries();
                setNotice("");
                setModal(null);
              }}
            />
          ) : modal === "tank" && car ? (
            <TankForm
              driver={car}
              currentLitres={
                advice?.estimatedCurrentLitres ?? car.currentLitres
              }
              onDone={() => {
                setModal(null);
                setNotice("Your tank reading is up to date.");
              }}
            />
          ) : (
            <DriverForm
              driver={driver.data}
              currentLitres={advice?.estimatedCurrentLitres}
              onDone={() => {
                setModal(null);
                setNotice("Your car, driving schedule and stations are saved.");
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
