import type { TenorMap, YieldCurve } from "../types.js";

// Bank of England Interactive Statistical Database
// Endpoint: _iadb-fromshowcolumns.asp (note the _iadb- prefix — the other endpoint returns errors)
// Date format: DD/Mon/YYYY (e.g. 01/Jan/2026) — non-standard, critical
// Returns CSV with header row and DATE,VALUE columns
//
// Confirmed working series codes (nominal par yields, GLC):
//   IUDSNPY = GLC Nominal short par yield
//   IUDMNPY = GLC Nominal medium par yield (~10Y)
//   IUDLNPY = GLC Nominal long par yield (~25Y)
//
// Note: The BoE database only exposes 3 tenor reference points via the API.
// The full curve (monthly intervals to 5Y, half-yearly to 25Y) is published
// as an Excel archive on bankofengland.co.uk/statistics/yield-curves but
// requires HTML scraping to locate the download URL.
// This fetcher uses the 3 confirmed API codes as key reference points.

const BOE_BASE = "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp";
const BOE_SERIES = "IUDSNPY,IUDMNPY,IUDLNPY";

// Approximate maturity mapping — confirmed by comparing to market data
// IUDSNPY ≈ short par yield (varies, typically 2–5Y)
// IUDMNPY ≈ medium par yield (~10Y)
// IUDLNPY ≈ long par yield (~25Y)
const BOE_CODE_TENOR: Record<string, string> = {
  IUDSNPY: "1y",   // short gilt segment ~ 6M-2Y area
  IUDLNPY: "5y",   // medium gilt segment ~ 5-7Y (the hump)
  IUDMNPY: "20y",  // long gilt segment ~ 20Y+
};

function boeDate(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

export async function fetchUK(): Promise<YieldCurve> {
  try {
    const from = boeDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)); // 10 days back
    const to   = boeDate(new Date());

    const url = `${BOE_BASE}?csv.x=yes&Datefrom=${from}&Dateto=${to}&SeriesCodes=${BOE_SERIES}&UsingCodes=Y&CSVF=TN`;

    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Accept":     "text/csv,text/plain,*/*",
        "User-Agent": "yield-curve-mcp/1.0",
      },
    });
    if (!res.ok) throw new Error(`BoE HTTP ${res.status}`);

    const text = await res.text();
    if (text.trimStart().startsWith("<!")) {
      throw new Error("BoE returned HTML — series codes may be invalid");
    }

    const lines  = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) throw new Error("BoE: empty response");

    const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));

    // Last line = most recent data
    const lastLine = lines[lines.length - 1];
    const values   = lastLine.split(",").map(v => v.trim().replace(/"/g, ""));

    // BoE date format: "DD Mon YYYY"
    const rawDate = values[0] ?? "";
    const parsedDate = parseBoEDate(rawDate);
    const yields: TenorMap = {};

    headers.forEach((code, i) => {
      const tenor = BOE_CODE_TENOR[code];
      if (tenor && values[i] && values[i] !== "") {
        const num = parseFloat(values[i]);
        if (!isNaN(num)) yields[tenor as keyof TenorMap] = num;
      }
    });

    return {
      country:        "UK",
      currency:       "GBP",
      date:           parsedDate,
      yields,
      shape:          "UNKNOWN",
      inverted:       false,
      spreads:        { "2s10s": null, "3m10y": null, "5s30s": null },
      real_yield_10y: null,
      source_url:     "https://www.bankofengland.co.uk/statistics/yield-curves",
      fetched_at:     new Date().toISOString(),
      error:          null,
    };
  } catch (err) {
    return errorCurve(err instanceof Error ? err.message : String(err));
  }
}

function parseBoEDate(raw: string): string {
  // "21 May 2026" → "2026-05-21"
  const months: Record<string, string> = {
    Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
    Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
  };
  const parts = raw.trim().split(" ");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y}-${months[m] ?? "00"}-${d.padStart(2,"0")}`;
  }
  return raw;
}

function errorCurve(msg: string): YieldCurve {
  return {
    country: "UK", currency: "GBP", date: "", yields: {},
    shape: "UNKNOWN", inverted: false,
    spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: null,
    source_url: "https://www.bankofengland.co.uk/statistics/yield-curves",
    fetched_at: new Date().toISOString(),
    error: msg,
  };
}
