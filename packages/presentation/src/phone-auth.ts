/** Accept common UK input formats, but send a single E.164 identity to the API. */
export function normalizeUkMobile(input: string): string | undefined {
  let phone = input.trim().replace(/[\s()-]/g, "");
  if (phone.startsWith("0044")) phone = "+44" + phone.slice(4);
  else if (phone.startsWith("07")) phone = "+44" + phone.slice(1);
  return /^\+447\d{9}$/.test(phone) ? phone : undefined;
}
