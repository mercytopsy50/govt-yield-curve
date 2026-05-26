# bond-yield-curve

Multi-country sovereign yield curve data via MCP. Returns normalized yield curves, curve shape classification, key spreads, and cross-country comparisons for US, UK, Eurozone, Japan, and Germany — updated daily from official government sources.

## Data Sources

| Country | Source | Tenors | Auth |
|---|---|---|---|
| US | FRED API (St. Louis Fed) | 3m, 6m, 1y, 2y, 3y, 5y, 7y, 10y, 20y, 30y + TIPS real yield | Free API key |
| UK | Bank of England Interactive Database | Short, medium (~20y), long (~5y) par yields | None |
| ECB (Eurozone) | ECB Statistical Data Warehouse — YC dataset, Svensson model `SV_C_YM` | 1y, 2y, 3y, 5y, 7y, 10y, 20y, 30y | None |
| Japan | Japan MOF daily JGB CSV | 1y, 2y, 3y, 5y, 7y, 10y, 15y, 20y, 25y, 30y | None |
| Germany | Bundesbank StatisticDownload CSV — BBSIS flow | 1y, 2y, 3y, 5y, 7y, 10y, 15y, 20y, 30y | None |

All sources are official government or central bank publications. No third-party data vendors. No scraping.

## MCP Tools

### `get_yield_curve`
Get the current sovereign yield curve for one country.

**Input:** `{ country: "US" | "UK" | "ECB" | "JP" | "DE" }`

**Output:**
```json
{
  "country": "US",
  "currency": "USD",
  "date": "2026-05-21",
  "yields": { "2y": 4.08, "5y": 4.21, "10y": 4.57, "30y": 4.83 },
  "shape": "NORMAL",
  "inverted": false,
  "spreads": { "2s10s": 49, "3m10y": 89, "5s30s": 85 },
  "real_yield_10y": 2.14,
  "source_url": "https://fred.stlouisfed.org",
  "error": null
}
```

### `compare_yield_curves`
Compare yield curves across multiple countries simultaneously. Returns per-country data, a cross-country spread matrix in basis points, and a plain-language narrative.

**Input:** `{ countries?: ["US", "ECB", "JP", "DE", "UK"] }`  
Defaults to all five if omitted.

### `get_curve_analytics`
Detailed analytics for one country: shape classification, inversion status, all three key spreads, and real yield for the US.

**Input:** `{ country: "US" | "UK" | "ECB" | "JP" | "DE" }`

### `get_all_curves`
Fetch all five countries in a single call. Preferred for agents that need a global overview.

**Input:** `{}` (no parameters)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default 3000) | Server port |
| `FRED_API_KEY` | Yes (for US data) | Free key from [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) |

UK, ECB, Japan, and Germany require no API keys.

## Running Locally

```bash
npm install
FRED_API_KEY=your_key npm run dev
```

Test:
```bash
# US yield curve
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"get_yield_curve","arguments":{"country":"US"}}}' \
  | jq '.result.structuredContent'

# Five-country comparison
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"compare_yield_curves","arguments":{}}}' \
  | jq '.result.structuredContent.narrative'
```

## Deployment (Railway)

```bash
# Push to GitHub, then connect repo in Railway
# Set environment variable: FRED_API_KEY=your_key
# Railway auto-detects nixpacks.toml and builds from TypeScript
```

## Caching

All yield data is cached in-memory with a 24-hour TTL matching the daily publication cadence of each source. On-demand fetches on cache miss; pre-warmed by cron jobs timed to each source's publication window (weekdays only):

- Japan MOF: 00:30 UTC (8:30am JST)
- ECB + Bundesbank: 11:05 UTC (noon CET)
- UK BoE: 08:35 UTC
- US FRED: 21:20 UTC (4:20pm ET)

## Notes on UK Coverage

The Bank of England's public database API exposes only three tenor reference points for nominal par yields (`IUDSNPY`, `IUDMNPY`, `IUDLNPY`) rather than a full term structure. These map approximately to short (~1y), medium (~20y), and long (~5y) segments of the gilt curve. The full curve is available in the BoE's Excel archive but requires HTML parsing to locate dynamically. UK cross-country spreads in the matrix will show null at tenors not covered.

## Spread Conventions

All spreads are in basis points (bps). Sign convention: positive = long rate above short rate (normal curve), negative = inversion.

- `2s10s`: 10-year minus 2-year yield
- `3m10y`: 10-year minus 3-month yield  
- `5s30s`: 30-year minus 5-year yield
