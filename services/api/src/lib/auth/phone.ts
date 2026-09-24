import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { Config } from "../../app/config";

export const phoneAuthEnabled = (config: Config) =>
  Boolean(
    config.twilioAccountSid &&
    config.twilioAuthToken &&
    config.twilioVerifyServiceSid,
  );

// Store one canonical identity, even if clients accept local UK formatting.
export function validUkMobile(value: string) {
  if (!/^\+447\d{9}$/.test(value)) return false;
  const parsed = parsePhoneNumberFromString(value);
  return (
    parsed?.countryCallingCode === "44" &&
    parsed.isValid() &&
    parsed.getType() === "MOBILE"
  );
}
