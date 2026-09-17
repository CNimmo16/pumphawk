import { AppError } from "../app/errors";
export type HttpClient = typeof fetch;
// Bound provider responses and timeouts. Never include upstream bodies (which can contain tokens) in errors.
export async function providerText(
  http: HttpClient,
  url: string,
  init: RequestInit = {},
  maxBytes = 24_000_000,
) {
  const response = await http(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      "PROVIDER_ERROR",
      `${new URL(url).hostname} returned HTTP ${response.status}.`,
      503,
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      "PROVIDER_EMPTY",
      "The data provider returned no response.",
      503,
    );
  const decoder = new TextDecoder();
  let result = "",
    bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new AppError(
          "PROVIDER_TOO_LARGE",
          "Provider response exceeded the download limit.",
          503,
        );
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return result + decoder.decode();
}
// RFC 4180 parser for Databento's header-based CSV output, including quoted commas/newlines.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Incomplete CSV download");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  if (rows.some((r) => r.length !== header.length))
    throw new Error("Malformed CSV download");
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])),
  );
}
