import type { TenorMap, YieldCurve } from "../types.js";

// Bundesbank StatisticDownload CSV endpoint
// Works where the SDMX JSON API returns empty — same data, different format
// URL: https://www.bundesbank.de/statistic-rmi/StatisticDownload?tsId=BBSIS.{key}&its_fileFormat=csv&mode=its
// CSV uses German decimal (comma), semicolon delimited, date format YYYY-MM-DD
// Confirmed working: R02XX (2Y), R10XX (10Y)

const BBK_BASE = "https://www.bundesbank.de/statistic-rmi/StatisticDownload";
const BBK_PREFIX = "BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604";
const BBK_SUFFIX = "R.A.A._Z._Z.A";

const BBK_TENORS: Array<[string, string]> = [
  ["R01XX", "1y"],
  ["R02XX", "2y"],
  ["R03XX", "3y"],
  ["R05XX", "5y"],
  ["R07XX", "7y"],
  ["R10XX", "10y"],
  ["R15XX", "15y"],
  ["R20XX", "20y"],
  ["R30XX", "30y"],
];

async function fetchBbkSeries(tenorCode: string): Promise<{ date: string; value: number | null }> {
  const tsId = `${BBK_PREFIX}.${tenorCode}.${BBK_SUFFIX}`;
  const url  = `${BBK_BASE}?tsId=${tsId}&its_fileFormat=csv&mode=its`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Bundesbank HTTP ${res.status} for ${tenorCode}`);

  const text  = await res.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Find the last data line: format is YYYY-MM-DD;3,21;
  let latestDate  = "";
  let latestValue: number | null = null;

  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 2) continue;
    const datePart  = parts[0].replace(/"/g, "");
    const valuePart = parts[1].replace(/"/g, "").replace(",", ".");
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && valuePart !== "") {
      const num = parseFloat(valuePart);
      if (!isNaN(num)) {
        latestDate  = datePart;
        latestValue = parseFloat(num.toFixed(4));
      }
    }
  }

  return { date: latestDate, value: latestValue };
}

export async function fetchGermany(): Promise<YieldCurve> {
  try {
    const results = await Promise.allSettled(
      BBK_TENORS.map(([code]) => fetchBbkSeries(code))
    );

    const yields: TenorMap = {};
    let latestDate = "";

    BBK_TENORS.forEach(([, tenor], i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        yields[tenor as keyof TenorMap] = r.value.value;
        if (r.value.date > latestDate) latestDate = r.value.date;
      } else {
        yields[tenor as keyof TenorMap] = null;
      }
    });

    return {
      country:        "DE",
      currency:       "EUR",
      date:           latestDate,
      yields,
      shape:          "UNKNOWN",
      inverted:       false,
      spreads:        { "2s10s": null, "3m10y": null, "5s30s": null },
      real_yield_10y: null,
      source_url:     "https://www.bundesbank.de/statistic-rmi/StatisticDownload",
      fetched_at:     new Date().toISOString(),
      error:          null,
    };
  } catch (err) {
    return errorCurve(err instanceof Error ? err.message : String(err));
  }
}

function errorCurve(msg: string): YieldCurve {
  return {
    country: "DE", currency: "EUR", date: "", yields: {},
    shape: "UNKNOWN", inverted: false,
    spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: null,
    source_url: "https://www.bundesbank.de/statistic-rmi/StatisticDownload",
    fetched_at: new Date().toISOString(),
    error: msg,
  };
}
