import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getVehicleLookupAvailabilityOptions,
  lookupVehicleMutation,
} from "@pump-hawk/openapi/react-query";
import type { VehicleLookup } from "@pump-hawk/openapi/types";
import { Search, Check } from "lucide-react";
import { errorMessage } from "../lib/api";

export function VehicleLookupForm({
  onApply,
}: {
  onApply: (car: VehicleLookup) => void;
}) {
  const [registration, setRegistration] = useState("");
  const [applied, setApplied] = useState(false);
  const availability = useQuery({
    ...getVehicleLookupAvailabilityOptions(),
    staleTime: 60_000,
    retry: false,
  });
  const lookup = useMutation({ ...lookupVehicleMutation(), retry: false });
  // Manual entry remains fully usable while the optional provider is unavailable.
  if (!availability.data?.enabled) return null;
  const normalized = registration.replace(/ /g, "").toUpperCase();
  const valid = /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{2,7}$/.test(normalized);
  function find() {
    if (!valid || lookup.isPending) return;
    setApplied(false);
    lookup.mutate({ body: { registrationNumber: normalized } });
  }
  return (
    <section
      className="vehicle-lookup"
      aria-label="Find your car by registration"
    >
      <label htmlFor="registration">UK registration</label>
      <div className="vehicle-lookup-actions">
        <input
          id="registration"
          className="registration-input"
          placeholder="AB12 CDE"
          maxLength={10}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          disabled={lookup.isPending}
          value={registration}
          onChange={(event) => {
            setRegistration(event.target.value.toUpperCase());
            lookup.reset();
            setApplied(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              find();
            }
          }}
        />
        <button
          type="button"
          className="button outline"
          disabled={!valid || lookup.isPending}
          onClick={find}
        >
          <Search size={16} />
          {lookup.isPending ? "Finding your car…" : "Find my car"}
        </button>
      </div>
      <p className="fine-print">
        We send your registration to One Auto API to find your car’s
        specifications. Your plate isn’t saved to your profile. You can also
        enter details below.
      </p>
      {lookup.isPending && (
        <p role="status" className="muted">
          Looking up your car…
        </p>
      )}
      {lookup.error && (
        <p role="alert" className="form-error">
          {errorMessage(lookup.error)}
        </p>
      )}
      {lookup.data && (
        <div className="vehicle-match" aria-live="polite">
          <strong>{lookup.data.vehicleName}</strong>
          <span>
            {[lookup.data.year, lookup.data.fuelType]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <dl>
            <div>
              <dt>Tank capacity</dt>
              <dd>
                {lookup.data.tankCapacityLitres === null
                  ? "Enter manually"
                  : `${lookup.data.tankCapacityLitres} litres`}
              </dd>
            </div>
            <div>
              <dt>Combined economy</dt>
              <dd>
                {lookup.data.mpg === null
                  ? "Enter manually"
                  : `${lookup.data.mpg} UK MPG`}
              </dd>
            </div>
          </dl>
          {lookup.data.warnings.map((warning) => (
            <p className="fine-print" key={warning}>
              {warning}
            </p>
          ))}
          <p className="fine-print">
            Check this is your car. You can edit all figures below, including
            the fuel in your tank now.
          </p>
          <button
            type="button"
            className="button outline"
            disabled={applied}
            onClick={() => {
              onApply(lookup.data!);
              setApplied(true);
            }}
          >
            {applied && <Check size={16} />}
            {applied ? "Details applied" : "Use these details"}
          </button>
        </div>
      )}
    </section>
  );
}
