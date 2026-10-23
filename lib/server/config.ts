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
