import type { TenorMap, YieldCurve } from "../types.js";

// Japan MOF daily JGB benchmark yields
// URL: https://www.mof.go.jp/english/jgbs/reference/interest_rate/jgbcme.csv
// Returns HTTP 302 → must follow redirect with { redirect: "follow" }
// CSV columns: Date,1Y,2Y,3Y,4Y,5Y,6Y,7Y,8Y,9Y,10Y,15Y,20Y,25Y,30Y,40Y
// Last two lines are a blank line and a "clear cache" note — skip them

const MOF_URL = "https://www.mof.go.jp/english/jgbs/reference/interest_rate/jgbcme.csv";

const MOF_COL_MAP: Record<string, string> = {
  "1Y":  "1y",
  "2Y":  "2y",
  "3Y":  "3y",
  "5Y":  "5y",
  "7Y":  "7y",
  "10Y": "10y",
  "15Y": "15y",
  "20Y": "20y",
  "25Y": "25y",
  "30Y": "30y",
};

export async function fetchJapan(): Promise<YieldCurve> {
  try {
    const res = await fetch(MOF_URL, {
      redirect: "follow",                    // follow the 302 redirect
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "yield-curve-mcp/1.0 (open-source; contact via GitHub)",
        "Accept":     "text/csv,text/plain,*/*",
      },
    });
    if (!res.ok) throw new Error(`Japan MOF HTTP ${res.status}`);

    const text  = await res.text();
    const lines = text.split("\n").map(l => l.trim());

    // Skip header line, blank lines, and the trailing "clear cache" note
    const dataLines = lines.filter(l =>
      l && !l.startsWith('"') && /^\d{4}\/\d{1,2}\/\d{1,2}/.test(l)
    );
    if (!dataLines.length) throw new Error("Japan MOF: no data lines found");

    const headerLine = lines.find(l => l.startsWith("Date") || l.startsWith("date") || /^Date,/i.test(l));
    const headers    = headerLine
      ? headerLine.split(",").map(h => h.trim().replace(/"/g, ""))
      : ["Date","1Y","2Y","3Y","4Y","5Y","6Y","7Y","8Y","9Y","10Y","15Y","20Y","25Y","30Y","40Y"];

    const lastLine = dataLines[dataLines.length - 1];
    const values   = lastLine.split(",").map(v => v.trim().replace(/"/g, ""));
    const rawDate  = values[0] ?? "";
    const yields: TenorMap = {};

    headers.forEach((header, i) => {
      const tenor = MOF_COL_MAP[header.toUpperCase()];
      if (tenor && values[i] && values[i] !== "-" && values[i] !== "") {
        const parsed = parseFloat(values[i]);
        if (!isNaN(parsed)) yields[tenor as keyof TenorMap] = parsed;
      }
    });

    // Date format: YYYY/MM/DD → YYYY-MM-DD
    const parsedDate = rawDate.replace(/\//g, "-");

    return {
      country:        "JP",
      currency:       "JPY",
      date:           parsedDate,
      yields,
      shape:          "UNKNOWN",
      inverted:       false,
      spreads:        { "2s10s": null, "3m10y": null, "5s30s": null },
      real_yield_10y: null,
      source_url:     MOF_URL,
      fetched_at:     new Date().toISOString(),
      error:          null,
    };
  } catch (err) {
    return errorCurve(err instanceof Error ? err.message : String(err));
  }
}

function errorCurve(msg: string): YieldCurve {
  return {
    country: "JP", currency: "JPY", date: "", yields: {},
    shape: "UNKNOWN", inverted: false,
    spreads: { "2s10s": null, "3m10y": null, "5s30s": null },
    real_yield_10y: null,
    source_url: MOF_URL,
    fetched_at: new Date().toISOString(),
    error: msg,
  };
}
