# Registration lookup

Onboarding can identify a car and suggest its tank capacity and combined UK MPG from its UK registration. The driver reviews the match and chooses **Use these details**; every field stays editable. Missing specifications remain blank and must be entered manually. Current fuel level always comes from the driver.

## Provider and activation

The adapter uses **UK Vehicle Data's Vehicle & Model Details from VRM service through One Auto API**. Its public response schema includes `model_details.body_details.fuel_capacity_litres` and `model_details.fuel_economy`. The direct DVLA Vehicle Enquiry Service does not include these specifications.

1. Obtain a One Auto API account with access to the UK Vehicle Data **Vehicle & Model Details from VRM** endpoint. A direct UKVD API key is not interchangeable with a One Auto API key.
2. Add `ONE_AUTO_API_KEY` to GitHub's **production** environment secrets. The deployment workflow uploads it to the API Worker. For local development, add it to `services/api/.dev.vars`.
3. Deploy. The registration field appears only when the key is configured. Without a key, normal manual onboarding continues.
4. Perform a live lookup using a registration you are authorised to submit and check the matched derivative, tank size and fuel economy. Integration/browser tests use fixtures; live provider access has not been verified without a key.

The configured URL is `https://api.oneautoapi.com/ukvehicledata/vehicleandmodeldetailsfromvrm`. The API key is sent server-side in `x-api-key`; the provider requires the registration as a query parameter. No account was created, credit purchased or paid lookup made during implementation. Confirm your account's pricing and data-use terms before activating; the public page listed **20p per PAYG lookup** when checked on 18 September 2026.

## Behaviour and limits

- `GET /api/v1/me/vehicle-lookup` returns availability; `POST` to the same URL accepts `{ "registrationNumber": "AB12 CDE" }` and returns the typed `VehicleLookup` contract. Both require a session; POST also requires the app origin. The OpenAPI-generated SDK includes TanStack Query helpers.
- Spaces and letter case are normalised. Both old/private and Northern Irish registrations are accepted; the provider determines whether the plate exists.
- A single atomic PostgreSQL counter allows 10 attempts per user per UTC day, across Worker instances. Failed provider attempts consume quota too. Requests have a 10-second timeout and 256 KB response limit; they are never retried automatically. Set account-level usage limits with the provider as an additional budget control.
- Diesel, electric-only and other clearly unsupported fuels are rejected. This does not establish E10 compatibility. Unknown fuel types require review.
- Combined litres/100 km is converted explicitly to imperial MPG when available, otherwise the provider's combined MPG is used. These are published test-cycle figures, not measured driving economy. Hybrid MPG is left blank because published values can include electric travel.
- No database migration is required. The existing rate-limit table stores one counter per user, with no registration. Neither registrations nor raw provider responses are stored in Pump Hawk's database. Only the car fields confirmed during onboarding are saved. Upstream URLs, keys, response bodies and errors are excluded from application error reporting. Browser responses use `Cache-Control: no-store`.

## References

- [One Auto API endpoint, schema, prices and status codes](https://www.oneautoapi.com/service/uk-vehicle-data-vehicle-and-model-details-from-vrm-vin/)
- [DVLA VES schema](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/vehicle-enquiry-service/v1.2.0-vehicle-enquiry-service.html)
