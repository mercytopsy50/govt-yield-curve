import type { YieldCurve, CurveShape, SpreadMatrix, Tenor } from "./types.js";

// ── Curve shape classification ─────────────────────────────────────────────
// Uses 3m, 2y, 5y, 10y, 30y as anchor points
export function classifyCurveShape(curve: YieldCurve): CurveShape {
  const y = curve.yields;
  const short = y["3m"] ?? y["6m"] ?? y["1y"];
  const mid   = y["5y"];
  const long  = y["10y"] ?? y["15y"] ?? y["20y"] ?? y["25y"];
  const vlong = y["30y"] ?? y["20y"];

  if (short === null || short === undefined) return "UNKNOWN";
  if (long  === null || long  === undefined) return "UNKNOWN";

  const shortToLong = long - short;

  if (shortToLong > 0.5) {
    // Normal: long rates significantly above short
    if (mid !== null && mid !== undefined && mid > long + 0.3) return "HUMPED";
    return "NORMAL";
  }
  if (shortToLong < -0.2) return "INVERTED";

  // Flat: within 50bps
  return "FLAT";
}

// ── Spread computation ─────────────────────────────────────────────────────
function spread(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return parseFloat(((b - a) * 100).toFixed(1)); // return in bps
}

export function computeSpreads(curve: YieldCurve): YieldCurve["spreads"] {
  const y = curve.yields;
  return {
    "2s10s": spread(y["2y"],  y["10y"]),
    "3m10y": spread(y["3m"],  y["10y"]),
    "5s30s": spread(y["5y"],  y["30y"]),
  };
}

// ── Apply analytics to a raw curve object ─────────────────────────────────
export function enrichCurve(curve: YieldCurve): YieldCurve {
  if (curve.error) return curve;
  const shape   = classifyCurveShape(curve);
  const spreads = computeSpreads(curve);
  return {
    ...curve,
    shape,
    inverted: shape === "INVERTED",
    spreads,
  };
}

// ── Cross-country spread matrix ────────────────────────────────────────────
// Returns spread in bps (country_a - country_b) for each key tenor
const KEY_TENORS: Tenor[] = ["2y", "5y", "10y", "30y"];

export function buildSpreadMatrix(curves: YieldCurve[]): SpreadMatrix[] {
  const live = curves.filter(c => !c.error);

  return KEY_TENORS.map(tenor => {
    const matrix: Record<string, Record<string, number | null>> = {};

    live.forEach(a => {
      matrix[a.country] = {};
      live.forEach(b => {
        if (a.country === b.country) {
          matrix[a.country][b.country] = 0;
          return;
        }
        const va = a.yields[tenor];
        const vb = b.yields[tenor];
        matrix[a.country][b.country] =
          va != null && vb != null
            ? parseFloat(((va - vb) * 100).toFixed(1))
            : null;
      });
    });

    return {
      as_of:  live[0]?.date ?? "",
      tenor,
      matrix,
    };
  });
}

// ── Narrative summary ─────────────────────────────────────────────────────
export function buildNarrative(curves: YieldCurve[]): string {
  const lines: string[] = [];

  curves.forEach(c => {
    if (c.error) {
      lines.push(`${c.country}: data unavailable (${c.error})`);
      return;
    }
    const s10 = c.spreads["2s10s"];
    const s3m = c.spreads["3m10y"];
    const inv  = c.inverted ? "⚠️ INVERTED" : c.shape;
    // Use best available benchmark tenor for display
    const bench10y = c.yields["10y"] ?? c.yields["20y"] ?? c.yields["15y"] ?? c.yields["5y"] ?? null;
    const benchLabel = c.yields["10y"] != null ? "10y"
      : c.yields["20y"] != null ? "20y"
      : c.yields["15y"] != null ? "15y"
      : c.yields["5y"]  != null ? "5y"
      : "n/a";
    lines.push(
      `${c.country} (${c.date}): ${c.shape === "UNKNOWN" ? "n/a" : inv}` +
      ` | ${benchLabel}=${bench10y ?? "n/a"}%` +
      ` | 2s10s=${s10 != null ? s10 + "bps" : "n/a"}` +
      ` | 3m10y=${s3m != null ? s3m + "bps" : "n/a"}`
    );
  });

  const inverted = curves.filter(c => c.inverted).map(c => c.country);
  if (inverted.length) {
    lines.push(`\nInverted curves: ${inverted.join(", ")} — historically a leading recession indicator.`);
  }

  return lines.join("\n");
}
