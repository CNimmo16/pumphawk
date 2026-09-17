import type { Config } from "../app/config";
import { AppError } from "../app/errors";
import { parseCsv, providerText, type HttpClient } from "./http";
import { DAY } from "../pricing/forecast";
export type Settlement = {
  product: "B7H" | "BZ";
  symbol: string;
  date: string;
  priceUsd: number;
  expiresAt: Date;
  publishedAt: Date;
};
export function selectContracts(rows: Record<string, string>[], now: Date) {
  const unique = new Map<string, Record<string, string>>();
  for (const r of rows)
    if (
      r.instrument_class === "F" &&
      ["B7H", "BZ"].includes(r.asset!) &&
      Date.parse(r.expiration!) > now.getTime()
    )
      unique.set(r.raw_symbol!, r);
  return (["B7H", "BZ"] as const).flatMap((product) =>
    [...unique.values()]
      .filter((r) => r.asset === product)
      .sort((a, b) => a.expiration!.localeCompare(b.expiration!))
      .slice(0, 3),
  );
}
export function parseSettlements(
  rows: Record<string, string>[],
  definitions: Record<string, string>[],
): Settlement[] {
  const defs = new Map(definitions.map((d) => [d.raw_symbol, d]));
  const latest = new Map<string, Settlement>();
  for (const r of rows) {
    const d = defs.get(r.symbol);
    const flags = Number(r.stat_flags),
      price = Number(r.price);
    if (
      !d ||
      Number(r.stat_type) !== 3 ||
      !(flags & 1) ||
      flags & 8 ||
      !r.price ||
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 10000
    )
      continue;
    const date = r.ts_ref?.slice(0, 10),
      publishedAt = new Date(r.ts_recv!);
    if (!date || !Number.isFinite(publishedAt.getTime())) continue;
    const key = `${r.symbol}:${date}`,
      old = latest.get(key);
    if (old && old.publishedAt > publishedAt) continue;
    if (Number(r.update_action) === 2) {
      latest.delete(key);
      continue;
    }
    latest.set(key, {
      product: d.asset as "B7H" | "BZ",
      symbol: r.symbol!,
      date,
      priceUsd: price,
      expiresAt: new Date(d.expiration!),
      publishedAt,
    });
  }
  return [...latest.values()];
}
export class DatabentoService {
  static inject = ["config", "httpClient"] as const;
  constructor(
    private config: Config,
    private http: HttpClient,
  ) {}
  private async download(
    symbols: string,
    stype: string,
    schema: string,
    start: string,
    end: string,
  ) {
    if (!this.config.databentoApiKey)
      throw new AppError(
        "DATABENTO_NOT_CONFIGURED",
        "Databento API credentials are missing.",
        503,
      );
    const headers = {
      Authorization: `Basic ${btoa(this.config.databentoApiKey + ":")}`,
    };
    const params = new URLSearchParams({
      dataset: "GLBX.MDP3",
      symbols,
      stype_in: stype,
      schema,
      start,
      end,
    });
    // Fail closed above $0.25 per request; no batch orders or live subscriptions.
    const cost = JSON.parse(
      await providerText(
        this.http,
        `https://hist.databento.com/v0/metadata.get_cost?${params}`,
        { headers },
        10000,
      ),
    );
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost > 0.25)
      throw new AppError(
        "DATA_COST_LIMIT",
        "Databento download exceeds the configured $0.25 request limit.",
        503,
      );
    params.set("encoding", "csv");
    params.set("compression", "none");
    params.set("pretty_px", "true");
    params.set("pretty_ts", "true");
    params.set("map_symbols", "true");
    return parseCsv(
      await providerText(
        this.http,
        "https://hist.databento.com/v0/timeseries.get_range",
        { method: "POST", headers, body: params },
      ),
    );
  }
  async daily(now: Date, initial: boolean) {
    const end = now.toISOString().slice(0, 10);
    let definitionDay = new Date(Date.parse(end) - DAY);
    while ([0, 6].includes(definitionDay.getUTCDay()))
      definitionDay = new Date(+definitionDay - DAY);
    const definitions = await this.download(
      "B7H.FUT,BZ.FUT",
      "parent",
      "definition",
      definitionDay.toISOString().slice(0, 10),
      new Date(+definitionDay + DAY).toISOString().slice(0, 10),
    );
    const contracts = selectContracts(definitions, now);
    if (
      !contracts.some((d) => d.asset === "B7H") ||
      !contracts.some((d) => d.asset === "BZ")
    )
      throw new AppError(
        "NO_CONTRACTS",
        "No active B7H/Brent contracts were returned. Existing data was retained.",
        503,
      );
    const start = new Date(Date.parse(end) - (initial ? 35 : 7) * DAY)
      .toISOString()
      .slice(0, 10);
    const stats = await this.download(
      contracts.map((d) => d.raw_symbol).join(","),
      "raw_symbol",
      "statistics",
      start,
      end,
    );
    const settlements = parseSettlements(stats, contracts);
    if (
      !settlements.some((s) => s.product === "B7H") ||
      !settlements.some((s) => s.product === "BZ")
    )
      throw new AppError(
        "NO_SETTLEMENTS",
        "No final B7H/Brent settlements were returned. Existing data was retained.",
        503,
      );
    return { settlements, start, end };
  }
  async exchangeRates(start: string, end: string) {
    const rows = JSON.parse(
      await providerText(
        this.http,
        `https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD&providers=ecb&from=${start}&to=${end}`,
        {},
        100000,
      ),
    ) as { date: string; rate: number }[];
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.some(
        (r) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !(r.rate > 0.3 && r.rate < 3),
      )
    )
      throw new AppError(
        "FX_INVALID",
        "No valid GBP/USD reference rates were available.",
        503,
      );
    return rows.map((r) => ({ date: r.date, usdPerGbp: r.rate }));
  }
}
