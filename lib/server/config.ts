export const PORT = Number(process.env.PORT || 4100);
export const API_TOKEN = process.env.API_TOKEN || "demo_elapsed";

// Supabase (Postgres via its REST API) holds the database when configured. Use
// the service role key: it stays on the server and bypasses row level security.
export const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
export const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "acmedesk_db";

// Otherwise a JSON file in public/. On Vercel the project files are read-only,
// so /tmp is the only writable place (and it does not outlive the function
// instance).
export const DB_FILE =
  process.env.DB_FILE ||
  (process.env.VERCEL ? "/tmp/db.json" : `${process.cwd()}/public/db.json`);

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
