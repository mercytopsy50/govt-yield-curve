import "dotenv/config";

const get = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
};

export const ENV = {
  PORT:         parseInt(process.env.PORT ?? "3000", 10),
  NODE_ENV:     process.env.NODE_ENV ?? "development",
  CACHE_DB:     process.env.CACHE_DB ?? "./cache.db",
  // FRED API key — free at https://fred.stlouisfed.org/docs/api/api_key.html
  FRED_API_KEY: process.env.FRED_API_KEY ?? "",
} as const;
