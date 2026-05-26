import type { TenorMap, YieldCurve } from "../types.js";

// ECB Statistical Data Warehouse REST API
// Dataset: YC (yield curves)
// Key: B.U2.EUR.4F.G_N_A.SV_C_YM.SR_{tenor}
// Note: model identifier is SV_C_YM (continuous compounding yield error minimisation)
// NOT SV_CF_YM — that key does not exist and returns 404

const ECB_BASE = "https://data-api.ecb.europa.eu/service/data/YC";

const ECB_TENORS: Array<[string, string]> = [
  ["SR_1Y",  "1y"],
  ["SR_2Y",  "2y"],
  ["SR_3Y",  "3y"],
  ["SR_5Y",  "5y"],
  ["SR_7Y",  "7y"],
  ["SR_10Y", "10y"],
  ["SR_20Y", "20y"],
  ["SR_30Y", "30y"],
];

interface EcbJsonData {
  dataSets?: Array<{
    series?: Record<string, {
      observations?: Record<string, [number | null, ...unknown[]]>;
    }>;
  }>;
  structure?: {
    dimensions?: {
      observation?: Array<{ values?: Array<{ id: string }> }>;
    };
  };
}

async function fetchEcbSeries(tenorCode: string): Promise<{ date: string; value: number | null }> {
  const key = `B.U2.EUR.4F.G_N_A.SV_C_YM.${tenorCode}`;
  const url = `${ECB_BASE}/${encodeURIComponent(key)}?format=jsondata&lastNObservations=1`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`ECB HTTP ${res.status} for ${tenorCode}`);

  const data = await res.json() as EcbJsonData;

  const seriesEntry = Object.values(data.dataSets?.[0]?.series ?? {})[0];
  const obsEntries  = Object.entries(seriesEntry?.observations ?? {});
  if (!obsEntries.length) return { date: "", value: null };

  const [periodIdx, obsVal] = obsEntries[obsEntries.length - 1];
  const dates = data.structure?.dimensions?.observation?.[0]?.values ?? [];
  const date  = dates[parseInt(periodIdx)]?.id ?? "";
  const value = obsVal?.[0] ?? null;

  return { date, value: typeof value === "number" ? parseFloat(value.toFixed(4)) : null };
}

export async function fetchECB(): Promise<YieldCurve> {
  try {
    const results = await Promise.allSettled(
      ECB_TENORS.map(([code]) => fetchEcbSeries(code))
    );

    const yields: TenorMap = {};
    let latestDate = "";

    ECB_TENORS.forEach(([, tenor], i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        yields[tenor as keyof TenorMap] = r.value.value;
        if (r.value.date > latestDate) latestDate = r.value.date;
      } else {
        yields[tenor as keyof TenorMap] = null;
      }
    });

    return {
      country:        "ECB",
      currency:       "EUR",
      date:           latestDate,
      yields,
      shape:          "UNKNOWN",
      inverted:       false,
      spreads:        { "2s10s": null, "3m10y": null, "5s30s": null },
      real_yield_10y: null,
      source_url:     "https://data-api.ecb.europa.eu",
      fetched_at:     new Date().toISOString(),
      error:          null,
    };
  } catch (err) {
    return errorCurve(err instanceof Error ? err.message : String(err));
  }
}

function errorCurve(msg: string): YieldCurve {
  return {
    country: "ECB", currency: "EUR", date: "", yields: {},
    shape: "UNKNOWN", inverted: false,
    spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: null,
    source_url: "https://data-api.ecb.europa.eu",
    fetched_at: new Date().toISOString(),
    error: msg,
  };
}
