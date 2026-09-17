import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getNearbyStationsOptions,
  getTrackedStationsOptions,
  saveOnboardingMutation,
  updateTankMutation,
} from "@pump-hawk/openapi/react-query";
import type { Driver, DriverInput } from "@pump-hawk/openapi/types";
import { ArrowLeft, ArrowRight, Check, LocateFixed } from "lucide-react";
import { errorMessage } from "../lib/api";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "../lib/station-prices";
import { StationMap } from "./station-map";
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export function DriverForm({
  driver,
  currentLitres,
  onDone,
}: {
  driver?: Driver;
  currentLitres?: number;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0),
    [form, setForm] = useState<DriverInput>({
      vehicleName: driver?.vehicleName ?? "My car",
      tankCapacityLitres: driver?.tankCapacityLitres ?? 50,
      currentLitres: currentLitres ?? driver?.currentLitres ?? 20,
      mpg: driver?.mpg ?? 45,
      dailyMiles: driver?.dailyMiles ?? 20,
      smsEnabled: driver?.smsEnabled ?? false,
      mileageMode: driver?.mileageMode ?? "average",
      weekdayMiles: driver?.weekdayMiles ?? Array(7).fill(20),
    });
  const [location, setLocation] = useState<{
      latitude: number;
      longitude: number;
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [stationSort, setStationSort] = useState<"distance" | "price">("distance"),
    [postcode, setPostcode] = useState(""),
    [locating, setLocating] = useState(false),
    [error, setError] = useState("");
  const cache = useQueryClient();
  const tracked = useQuery(getTrackedStationsOptions());
  const nearby = useQuery({
    ...getNearbyStationsOptions({
      query: location ?? { latitude: 51.5, longitude: -0.1 },
    }),
    enabled: !!location,
    staleTime: 60000,
    retry: 1,
  });
  const stations = nearby.data?.stations ?? [];
  const median = stationPriceMedian(stations);
  const sortedStations = [...stations].sort((a, b) => {
    const distance =
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
    const price = (a.pricePence ?? Infinity) - (b.pricePence ?? Infinity);
    return (
      (stationSort === "price" ? price || distance : distance || price) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
  const save = useMutation({
    ...saveOnboardingMutation(),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onDone();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    if (location && selected.length)
      save.mutate({ body: { driver: form, location, stationIds: selected } });
  }
  function chooseLocation(value: { latitude: number; longitude: number }) {
    setLocation(value);
    setSelected([]);
    setError("");
  }
  function locate() {
    setLocating(true);
    setError("");
    if (!navigator.geolocation) {
      setError("Location is unavailable. Enter a postcode instead.");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        chooseLocation({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setError(
          "We couldn’t access your location. Enter a nearby postcode instead.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
  }
  async function findPostcode() {
    if (!postcode.trim()) return;
    setLocating(true);
    setError("");
    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const result = (await response.json()) as {
        result?: { latitude: number; longitude: number };
      };
      if (
        !response.ok ||
        !result.result ||
        !Number.isFinite(result.result.latitude)
      )
        throw new Error("Enter a valid UK postcode.");
      chooseLocation(result.result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Postcode lookup is unavailable.",
      );
    } finally {
      setLocating(false);
    }
  }
  function toggle(id: string) {
    setError("");
    setSelected((ids) =>
      ids.includes(id)
        ? ids.filter((s) => s !== id)
        : ids.length < 3
          ? [...ids, id]
          : ids,
    );
  }
  const numeric = (
    key: "tankCapacityLitres" | "currentLitres" | "mpg" | "dailyMiles",
    label: string,
    unit: string,
    min: number,
    max: number,
  ) => (
    <label key={key}>
      {label}
      <div className="input-unit">
        <input
          type="number"
          min={min}
          max={max}
          step="0.1"
          required
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
  return (
    <form onSubmit={submit} className="form-stack onboarding-form">
      <ol className="onboarding-steps">
        {["Your car", "Your driving", "Your stations"].map((name, i) => (
          <li
            key={name}
            className={i === step ? "active" : i < step ? "complete" : ""}
          >
            <span>{i < step ? <Check size={13} /> : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      <div>
        <div className="eyebrow">STEP {step + 1} OF 3</div>
        <h2>
          {
            [
              "A little about your car.",
              "What does your week look like?",
              "Find your regular stops.",
            ][step]
          }
        </h2>
        <p className="muted">
          {
            [
              "Enter your tank size and fuel economy. Vehicle registration lookup is coming later.",
              "Estimate your usual mileage. We’ll use it to plan how much petrol you need.",
              "Choose up to three E10 petrol stations within five miles. We’ll track their prices every hour.",
            ][step]
          }
        </p>
      </div>
      {step === 0 && (
        <>
          <label>
            Car name
            <input
              required
              maxLength={60}
              value={form.vehicleName}
              onChange={(e) =>
                setForm({ ...form, vehicleName: e.target.value })
              }
            />
          </label>
          <div className="form-grid">
            {numeric("tankCapacityLitres", "Tank capacity", "litres", 15, 150)}
            {numeric("mpg", "Average fuel economy", "UK MPG", 10, 150)}
            {numeric(
              "currentLitres",
              "Fuel in tank now",
              "litres",
              0,
              form.tankCapacityLitres,
            )}
          </div>
          <p className="fine-print">
            Use your current gauge reading. UK MPG uses imperial gallons.
          </p>
        </>
      )}
      {step === 1 && (
        <>
          <div
            className="segmented"
            role="group"
            aria-label="Mileage input method"
          >
            <button
              type="button"
              aria-pressed={form.mileageMode !== "weekly"}
              onClick={() => setForm({ ...form, mileageMode: "average" })}
            >
              Daily average
            </button>
            <button
              type="button"
              aria-pressed={form.mileageMode === "weekly"}
              onClick={() => setForm({ ...form, mileageMode: "weekly" })}
            >
              By day of the week
            </button>
          </div>
          {form.mileageMode !== "weekly" ? (
            numeric("dailyMiles", "Average miles per day", "miles", 0, 600)
          ) : (
            <div className="weekday-grid">
              {days.map((day, i) => (
                <label key={day}>
                  {day}
                  <div className="input-unit">
                    <input
                      required
                      type="number"
                      min={0}
                      max={600}
                      step="0.1"
                      value={form.weekdayMiles?.[i] ?? 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          weekdayMiles: days.map((_, d) =>
                            d === i
                              ? Number(e.target.value)
                              : (form.weekdayMiles?.[d] ?? 0),
                          ),
                        })
                      }
                    />
                    <span>miles</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {step === 2 && (
        <>
          <div className="location-actions">
            <button
              type="button"
              className="button outline"
              onClick={locate}
              disabled={locating}
            >
              <LocateFixed size={17} />
              {locating ? "Finding location…" : "Use my location"}
            </button>
            <span>or</span>
            <label className="postcode-label">
              <span className="sr-only">UK postcode</span>
              <input
                placeholder="UK postcode"
                maxLength={10}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void findPostcode();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="button outline"
              disabled={locating || !postcode.trim()}
              onClick={() => void findPostcode()}
            >
              Find
            </button>
          </div>
          <p className="fine-print">
            Your location is used to find stations, not saved to your profile.
            Postcode lookup uses Postcodes.io; the map uses OpenStreetMap.
          </p>
          {location && (
            <StationMap
              location={location}
              stations={nearby.data?.stations ?? []}
              selected={selected}
              onSelect={toggle}
            />
          )}
          {nearby.isFetching && location && (
            <p role="status" className="muted">
              Loading nearby prices…
            </p>
          )}
          {nearby.error && (
            <p role="alert" className="form-error">
              {errorMessage(nearby.error)}
            </p>
          )}
          {nearby.data && (
            <>
              <div className="station-list-heading">
                <div>
                  <strong>{selected.length} of 3 selected</strong>
                  <span>E10 · pence per litre</span>
                </div>
                <label className="station-sort">
                  Sort by
                  <select
                    value={stationSort}
                    onChange={(event) =>
                      setStationSort(
                        event.target.value === "price" ? "price" : "distance",
                      )
                    }
                  >
                    <option value="distance">Distance: nearest first</option>
                    <option value="price">Price: low to high</option>
                  </select>
                </label>
              </div>
              {nearby.data.stations.length === 0 ? (
                <p className="muted">
                  No reporting E10 stations within five miles. Try a nearby
                  postcode.
                </p>
              ) : (
                <div className="station-options">
                  {sortedStations.map((s) => {
                    const { band, description } = stationPriceComparison(
                      s.pricePence,
                      median,
                    );
                    return (
                      <label
                        className={`station-option ${selected.includes(s.id) ? "chosen" : ""}`}
                        key={s.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(s.id)}
                          disabled={
                            selected.length >= 3 && !selected.includes(s.id)
                          }
                          onChange={() => toggle(s.id)}
                        />
                        <span>
                          <strong>{s.name}</strong>
                          <small>
                            {s.postcode} · {s.distanceMiles?.toFixed(1)} miles
                            {s.motorway ? " · Motorway services" : ""}
                            {tracked.data?.stations.some((t) => t.id === s.id)
                              ? " · Currently tracked"
                              : ""}
                          </small>
                        </span>
                        <b
                          className={`station-price price-${band}`}
                          title={description}
                        >
                          {s.pricePence?.toFixed(1) ?? "—"}
                          <small>p</small>
                        </b>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="fine-print">
                Checked{" "}
                {nearby.data.checkedAt
                  ? new Date(nearby.data.checkedAt).toLocaleString("en-GB")
                  : "recently"}
                . Prices can change before your visit.
              </p>
            </>
          )}
        </>
      )}
      {(error || save.error) && (
        <p role="alert" className="form-error">
          {error || errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        {step > 0 && (
          <button
            type="button"
            className="button outline"
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft size={15} />
            Back
          </button>
        )}
        <button
          className="button dark"
          disabled={
            save.isPending ||
            (step === 2 && (!location || !selected.length || nearby.isFetching))
          }
        >
          {save.isPending
            ? "Saving…"
            : step === 2
              ? "Start my forecast"
              : "Continue"}
          <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}
export function TankForm({
  driver,
  currentLitres,
  onDone,
}: {
  driver: Driver;
  currentLitres: number;
  onDone: () => void;
}) {
  const [litres, setLitres] = useState(currentLitres),
    cache = useQueryClient();
  const save = useMutation({
    ...updateTankMutation(),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onDone();
    },
  });
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ body: { currentLitres: litres } });
      }}
    >
      <p className="muted">
        Confirm your gauge reading, including any petrol you’ve just added.
      </p>
      <label>
        Fuel in tank now (litres)
        <input
          required
          type="number"
          min={0}
          max={driver.tankCapacityLitres}
          step="0.1"
          value={litres}
          onChange={(e) => setLitres(Number(e.target.value))}
        />
      </label>
      <p className="fine-print">
        Your tank holds {driver.tankCapacityLitres} litres.
      </p>
      {save.error && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <button className="button dark" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Update tank level"}
      </button>
    </form>
  );
}
