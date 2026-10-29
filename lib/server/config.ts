export const PORT = Number(process.env.PORT || 4100);
export const API_TOKEN = process.env.API_TOKEN || "demo_elapsed";

// Redis (Upstash REST API) holds the database when configured. Vercel's Upstash
// integration sets KV_REST_API_*, Upstash itself UPSTASH_REDIS_REST_*.
export const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
export const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const REDIS_KEY = process.env.REDIS_KEY || "acmedesk:db";

// Otherwise a JSON file. On Vercel the project files are read-only, so /tmp is
// the only writable place (and it does not outlive the function instance).
export const DB_FILE =
  process.env.DB_FILE ||
  (process.env.VERCEL ? "/tmp/db.json" : `${process.cwd()}/data/db.json`);

// Synthetic data generator. Read lazily so tests (and ops) can change them.
const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);

  return Number.isInteger(n) && n >= min ? Math.min(n, max) : fallback;
};

export const generatorLimits = () => ({
  enabled: process.env.GENERATOR_ENABLED !== "0",
  /** Largest single request. */
  maxTickets: intEnv("GENERATOR_MAX_TICKETS", 1000, 1, 5000),
  /** Tickets written per batch (one bounded database save each). */
  batchSize: intEnv("GENERATOR_BATCH_SIZE", 50, 1, 200),
  /** Synthetic tickets allowed in the database at once, across all jobs. */
  maxTotal: intEnv("GENERATOR_MAX_TOTAL", 5000, 1, 20000),
});
