import type { TenorMap, YieldCurve } from "../types.js";
import { ENV } from "../env.js";

// FRED series → canonical tenor
const NOMINAL_SERIES: Array<[string, string]> = [
  ["DGS3MO", "3m"],
  ["DGS6MO", "6m"],
  ["DGS1",   "1y"],
  ["DGS2",   "2y"],
  ["DGS3",   "3y"],
  ["DGS5",   "5y"],
  ["DGS7",   "7y"],
  ["DGS10",  "10y"],
  ["DGS20",  "20y"],
  ["DGS30",  "30y"],
];

// 10-year TIPS breakeven (nominal 10y - TIPS 10y ≈ inflation expectation;
// real yield = nominal 10y - T10YIE breakeven)
const TIPS_SERIES = "T10YIE";

interface FredObs {
  date:  string;
  value: string;
}

interface FredResponse {
  observations?: FredObs[];
  error_message?: string;
}

async function fetchSeries(seriesId: string, apiKey: string): Promise<{ date: string; value: number | null }> {
  const url = `https://api.stlouisfed.org/fred/series/observations`
    + `?series_id=${seriesId}&api_key=${apiKey}&file_type=json`
    + `&limit=5&sort_order=desc&observation_start=2020-01-01`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  const data = await res.json() as FredResponse;

  // FRED returns "." for missing values — find most recent non-missing
  const obs = (data.observations ?? []).find(o => o.value !== ".");
  return {
    date:  obs?.date ?? "",
    value: obs ? parseFloat(obs.value) : null,
  };
}

export async function fetchUS(): Promise<YieldCurve> {
  const apiKey = ENV.FRED_API_KEY;
  if (!apiKey) {
    return errorCurve("FRED_API_KEY not set — get a free key at fred.stlouisfed.org");
  }

  // Fetch all nominal series + TIPS in parallel
  const allSeries = [...NOMINAL_SERIES.map(([id]) => id), TIPS_SERIES];
  const results = await Promise.allSettled(
    allSeries.map(id => fetchSeries(id, apiKey))
  );

  const yields: TenorMap = {};
  let latestDate = "";
  let tipsBE: number | null = null;

  NOMINAL_SERIES.forEach(([, tenor], i) => {
    const r = results[i];
    const val = r.status === "fulfilled" ? r.value.value : null;
    yields[tenor as keyof TenorMap] = val;
    if (r.status === "fulfilled" && r.value.date > latestDate) {
      latestDate = r.value.date;
    }
  });

  const tipsResult = results[NOMINAL_SERIES.length];
  if (tipsResult.status === "fulfilled") tipsBE = tipsResult.value.value;

  const nominal10y = yields["10y"] ?? null;
  const realYield  = nominal10y !== null && tipsBE !== null
    ? parseFloat((nominal10y - tipsBE).toFixed(3))
    : null;

  return {
    country:        "US",
    currency:       "USD",
    date:           latestDate,
    yields,
    shape:          "UNKNOWN", // computed by analytics layer
    inverted:       false,
    spreads:        { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: realYield,
    source_url:     "https://fred.stlouisfed.org",
    fetched_at:     new Date().toISOString(),
    error:          null,
  };
}

function errorCurve(msg: string): YieldCurve {
  return {
    country: "US", currency: "USD", date: "", yields: {},
    shape: "UNKNOWN", inverted: false,
    spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: null,
    source_url: "https://fred.stlouisfed.org",
    fetched_at: new Date().toISOString(),
    error: msg,
  };
}
