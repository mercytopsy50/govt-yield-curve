import express from "express";
import cron    from "node-cron";
import { ENV }  from "./env.js";
import { COUNTRIES, type Country } from "./types.js";
import { getAllCurves, getYieldCurve } from "./fetchers/index.js";
import { buildSpreadMatrix, buildNarrative } from "./analytics.js";

const app = express();
app.use(express.json());

// ── Shared sub-schemas ─────────────────────────────────────────────────────

const TENOR_MAP_SCHEMA = {
  type: "object",
  description: "Yield in percent at each available tenor. Only tenors published by the source are populated — missing tenors are absent from the object entirely. Canonical set: 3m, 6m, 1y, 2y, 3y, 5y, 7y, 10y, 15y, 20y, 25y, 30y.",
  properties: {
    "3m":  { type: ["number", "null"] },
    "6m":  { type: ["number", "null"] },
    "1y":  { type: ["number", "null"] },
    "2y":  { type: ["number", "null"] },
    "3y":  { type: ["number", "null"] },
    "5y":  { type: ["number", "null"] },
    "7y":  { type: ["number", "null"] },
    "10y": { type: ["number", "null"] },
    "15y": { type: ["number", "null"] },
    "20y": { type: ["number", "null"] },
    "25y": { type: ["number", "null"] },
    "30y": { type: ["number", "null"] },
  },
};

const SPREADS_SCHEMA = {
  type: "object",
  description: "Key spreads in basis points (bps). Positive = long rate above short rate (normal curve). Negative = inversion. Null if either tenor is missing.",
  properties: {
    "2s10s": { type: ["number", "null"], description: "10y minus 2y yield, bps. Primary recession signal." },
    "3m10y": { type: ["number", "null"], description: "10y minus 3m yield, bps. Estrella-Mishkin recession model input." },
    "5s30s": { type: ["number", "null"], description: "30y minus 5y yield, bps. Term premium and long-run inflation expectations." },
  },
  required: ["2s10s", "3m10y", "5s30s"],
};

const YIELD_CURVE_SCHEMA = {
  type: "object",
  description: "Sovereign yield curve for one country",
  properties: {
    country:        { type: "string", enum: ["US", "UK", "ECB", "JP", "DE"] },
    currency:       { type: "string", description: "ISO 4217 currency code (USD, GBP, EUR, JPY)" },
    date:           { type: "string", description: "ISO date of the yield data (YYYY-MM-DD)" },
    yields:         TENOR_MAP_SCHEMA,
    shape:          { type: "string", enum: ["NORMAL", "FLAT", "INVERTED", "HUMPED", "UNKNOWN"], description: "NORMAL: 10y > 2y. FLAT: spread <25bps. INVERTED: 2y > 10y. HUMPED: intermediate rates highest." },
    inverted:       { type: "boolean", description: "True when 2s10s spread is negative" },
    spreads:        SPREADS_SCHEMA,
    real_yield_10y: { type: ["number", "null"], description: "US only: 10y nominal yield minus TIPS 10y breakeven (FRED T10YIE). Null for all other countries." },
    source_url:     { type: "string", description: "URL of the official data source" },
    fetched_at:     { type: "string", description: "ISO 8601 timestamp of data retrieval" },
    error:          { type: ["string", "null"], description: "Fetch or parse error message. Null on success. When set, yields may be empty." },
  },
  required: ["country", "currency", "date", "yields", "shape", "inverted", "spreads", "real_yield_10y", "source_url", "fetched_at", "error"],
};

const SPREAD_MATRIX_SCHEMA = {
  type: "object",
  description: "Cross-country yield spread matrix at one tenor",
  properties: {
    as_of:  { type: "string", description: "ISO date" },
    tenor:  { type: "string", description: "Tenor for which this matrix was computed, e.g. '10y'" },
    matrix: {
      type: "object",
      description: "Country vs country spread in bps. matrix[A][B] = yield_A - yield_B at this tenor. Null if either country lacks data at this tenor.",
      additionalProperties: {
        type: "object",
        additionalProperties: { type: ["number", "null"] },
      },
    },
  },
  required: ["as_of", "tenor", "matrix"],
};

// ── MCP tool registry ──────────────────────────────────────────────────────
const TOOLS = [
  {
    name:        "get_yield_curve",
    description: "Get the current sovereign yield curve for a country. Returns yields across all available tenors, curve shape classification, and key spreads.",
    inputSchema: {
      type: "object",
      properties: {
        country: {
          type: "string",
          enum: [...COUNTRIES],
          description: "Country/region code: US, UK, ECB (Eurozone), JP (Japan), DE (Germany)",
        },
      },
      required: ["country"],
    },
    outputSchema: YIELD_CURVE_SCHEMA,
  },
  {
    name:        "compare_yield_curves",
    description: "Compare sovereign yield curves across multiple countries. Returns per-country data, cross-country spread matrix in basis points, and a plain-language narrative summary.",
    inputSchema: {
      type: "object",
      properties: {
        countries: {
          type: "array",
          items: { type: "string", enum: [...COUNTRIES] },
          description: "List of country codes to compare. Defaults to all five (US, UK, ECB, JP, DE).",
        },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "ISO date of this comparison (server date, not data date — individual curves carry their own data dates)",
        },
        curves: {
          type: "array",
          description: "One YieldCurve object per requested country",
          items: YIELD_CURVE_SCHEMA,
        },
        spread_matrix: {
          type: "array",
          description: "Cross-country spread matrices at key tenors (2y, 5y, 10y, 30y). One matrix object per tenor.",
          items: SPREAD_MATRIX_SCHEMA,
        },
        narrative: {
          type: "string",
          description: "Plain-language summary of curve shapes, inversion status, and notable cross-country spreads",
        },
      },
      required: ["date", "curves", "spread_matrix", "narrative"],
    },
  },
  {
    name:        "get_curve_analytics",
    description: "Get detailed analytics for a country's yield curve: shape classification (NORMAL/FLAT/INVERTED/HUMPED), inversion status, all three key spreads (2s10s, 3m10y, 5s30s), and real yield for the US.",
    inputSchema: {
      type: "object",
      properties: {
        country: {
          type: "string",
          enum: [...COUNTRIES],
          description: "Country/region code",
        },
      },
      required: ["country"],
    },
    outputSchema: {
      type: "object",
      properties: {
        country:        { type: "string", enum: ["US", "UK", "ECB", "JP", "DE"] },
        date:           { type: "string", description: "ISO date of the underlying yield data" },
        shape:          { type: "string", enum: ["NORMAL", "FLAT", "INVERTED", "HUMPED", "UNKNOWN"] },
        inverted:       { type: "boolean" },
        spreads_bps:    SPREADS_SCHEMA,
        real_yield_10y: { type: ["number", "null"], description: "US only: nominal 10y minus TIPS breakeven, percent" },
        yields:         TENOR_MAP_SCHEMA,
        interpretation: { type: "string", description: "Plain-language reading of the spreads and real yield" },
        error:          { type: ["string", "null"] },
      },
      required: ["country", "date", "shape", "inverted", "spreads_bps", "real_yield_10y", "yields", "interpretation", "error"],
    },
  },
  {
    name:        "get_all_curves",
    description: "Fetch current yield curves for all five countries simultaneously. Returns the full data set in a single call — preferred for agents that need a global overview.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    outputSchema: {
      type: "object",
      description: "Keyed by country code (US, UK, ECB, JP, DE). Each value is a full YieldCurve object.",
      additionalProperties: YIELD_CURVE_SCHEMA,
    },
  },
];

// ── Tool handler ───────────────────────────────────────────────────────────
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_yield_curve": {
      const country = args.country as Country;
      if (!COUNTRIES.includes(country)) throw new Error(`Unknown country: ${country}`);
      return getYieldCurve(country);
    }

    case "compare_yield_curves": {
      const requested = (args.countries as Country[] | undefined);
      const targets   = requested?.length ? requested : undefined;
      const curves    = await getAllCurves(targets);
      const matrix    = buildSpreadMatrix(curves);
      const narrative = buildNarrative(curves);
      return { date: new Date().toISOString().slice(0, 10), curves, spread_matrix: matrix, narrative };
    }

    case "get_curve_analytics": {
      const country = args.country as Country;
      if (!COUNTRIES.includes(country)) throw new Error(`Unknown country: ${country}`);
      const curve = await getYieldCurve(country);
      return {
        country:         curve.country,
        date:            curve.date,
        shape:           curve.shape,
        inverted:        curve.inverted,
        spreads_bps:     curve.spreads,
        real_yield_10y:  curve.real_yield_10y,
        yields:          curve.yields,
        interpretation: interpretSpreads(curve),
        error:           curve.error,
      };
    }

    case "get_all_curves": {
      return getAllCurves();
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function interpretSpreads(curve: ReturnType<typeof Object.create>): string {
  const msgs: string[] = [];
  const s2s10 = curve.spreads?.["2s10s"];
  const s3m10 = curve.spreads?.["3m10y"];

  if (s2s10 !== null && s2s10 !== undefined) {
    if (s2s10 < 0)        msgs.push(`2s10s spread is ${s2s10}bps — curve inverted at this segment.`);
    else if (s2s10 < 25)  msgs.push(`2s10s spread is ${s2s10}bps — curve very flat.`);
    else if (s2s10 > 150) msgs.push(`2s10s spread is ${s2s10}bps — curve steeply normal.`);
    else                  msgs.push(`2s10s spread is ${s2s10}bps.`);
  }
  if (s3m10 !== null && s3m10 !== undefined) {
    if (s3m10 < 0) msgs.push(`3m10y spread is ${s3m10}bps — historically a reliable recession precursor.`);
  }
  if (curve.real_yield_10y !== null && curve.real_yield_10y !== undefined) {
    msgs.push(`US real 10y yield: ${curve.real_yield_10y}% (nominal minus TIPS breakeven).`);
  }
  return msgs.join(" ") || "Insufficient data for interpretation.";
}

// ── MCP JSON-RPC endpoint ──────────────────────────────────────────────────
app.post("/mcp", async (req, res) => {
  const { jsonrpc, method, id, params } = req.body ?? {};

  if (jsonrpc !== "2.0") {
    return res.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC" } });
  }

  try {
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities:    { tools: {} },
          serverInfo:      { name: "yield-curve-mcp", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params ?? {};
      const result = await callTool(name, args ?? {});
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        },
      });
    }

    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({
      jsonrpc: "2.0", id,
      result: {
        content: [{ type: "text", text: `Error: ${msg}` }],
        structuredContent: { error: msg },
        isError: true,
      },
    });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", server: "yield-curve-mcp" }));

app.listen(ENV.PORT, () => {
  console.log(`yield-curve-mcp listening on :${ENV.PORT}`);

  // Pre-warm cache after each source's daily publication window (UTC)
  // US FRED  ~21:15 UTC (4:15pm ET)
  cron.schedule("20 21 * * 1-5", () => {
    console.log("[cron] warming US curve");
    getYieldCurve("US").catch(console.error);
  });

  // ECB SDW ~11:00 UTC (noon CET)
  cron.schedule("5 11 * * 1-5", () => {
    console.log("[cron] warming ECB + DE curves");
    Promise.all([getYieldCurve("ECB"), getYieldCurve("DE")]).catch(console.error);
  });

  // Japan MOF ~00:30 UTC (8:30am JST)
  cron.schedule("30 0 * * 1-5", () => {
    console.log("[cron] warming JP curve");
    getYieldCurve("JP").catch(console.error);
  });

  // UK DMO ~08:30 UTC
  cron.schedule("35 8 * * 1-5", () => {
    console.log("[cron] warming UK curve");
    getYieldCurve("UK").catch(console.error);
  });
});
