import type { Country, YieldCurve } from "../types.js";
import { cacheGet, cacheSet, TTL } from "../cache.js";
import { enrichCurve } from "../analytics.js";
import { fetchUS }      from "./us.js";
import { fetchUK }      from "./uk.js";
import { fetchECB }     from "./ecb.js";
import { fetchJapan }   from "./japan.js";
import { fetchGermany } from "./germany.js";

const FETCHERS: Record<Country, () => Promise<YieldCurve>> = {
  US:  fetchUS,
  UK:  fetchUK,
  ECB: fetchECB,
  JP:  fetchJapan,
  DE:  fetchGermany,
};

function cacheKey(country: Country): string {
  return `yield:${country}:${new Date().toISOString().slice(0, 10)}`;
}

export async function getYieldCurve(country: Country): Promise<YieldCurve> {
  const key    = cacheKey(country);
  const cached = cacheGet<YieldCurve>(key);
  if (cached) return cached;

  const raw     = await FETCHERS[country]();
  const enriched = enrichCurve(raw);
  cacheSet(key, enriched, TTL.YIELD_CURVE);
  return enriched;
}

export async function getAllCurves(countries?: Country[]): Promise<YieldCurve[]> {
  const targets = countries ?? (Object.keys(FETCHERS) as Country[]);
  const results = await Promise.allSettled(targets.map(c => getYieldCurve(c)));
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const country = targets[i];
    return {
      country, currency: "", date: "", yields: {},
      shape: "UNKNOWN" as const, inverted: false,
      spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
      real_yield_10y: null, source_url: "",
      fetched_at: new Date().toISOString(),
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}
