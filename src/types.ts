// ── Canonical tenor set ───────────────────────────────────────────────────
export const TENORS = ["3m","6m","1y","2y","3y","5y","7y","10y","15y","20y","25y","30y"] as const;
export type Tenor = typeof TENORS[number];

export type TenorMap = Partial<Record<Tenor, number | null>>;

// ── Countries ─────────────────────────────────────────────────────────────
export const COUNTRIES = ["US","UK","ECB","JP","DE"] as const;
export type Country = typeof COUNTRIES[number];

// ── Curve shape ───────────────────────────────────────────────────────────
export type CurveShape = "NORMAL" | "FLAT" | "INVERTED" | "HUMPED" | "UNKNOWN";

// ── Per-country yield curve object ─────────────────────────────────────────
export interface YieldCurve {
  country:       Country;
  currency:      string;
  date:          string;           // ISO date of data
  yields:        TenorMap;         // yield in % e.g. 4.25
  shape:         CurveShape;
  inverted:      boolean;
  spreads: {
    "2s10s":     number | null;    // 10y - 2y
    "3m10y":     number | null;    // 10y - 3m
    "5s30s":     number | null;    // 30y - 5y
  };
  real_yield_10y: number | null;   // US only (TIPS breakeven)
  source_url:    string;
  fetched_at:    string;           // ISO timestamp
  error:         string | null;
}

// ── Cross-country comparison ───────────────────────────────────────────────
export interface SpreadMatrix {
  as_of:    string;
  tenor:    Tenor;
  matrix:   Record<string, Record<string, number | null>>; // country vs country spread in bps
}

export interface CrossCountryComparison {
  date:         string;
  curves:       YieldCurve[];
  spread_matrix: SpreadMatrix[];   // one matrix per key tenor
  narrative:    string;
}

// ── Historical spread ──────────────────────────────────────────────────────
export interface HistoricalSpreadPoint {
  date:   string;
  value:  number | null;
}

export interface HistoricalSpread {
  country:     Country;
  spread_type: "2s10s" | "3m10y" | "5s30s";
  unit:        "bps";
  data:        HistoricalSpreadPoint[];
}

// ── Cache row ─────────────────────────────────────────────────────────────
export interface CacheRow {
  key:        string;
  value:      string;
  fetched_at: number;   // unix ms
  ttl_ms:     number;
}
