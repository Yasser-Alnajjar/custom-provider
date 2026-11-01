import { effectiveSettings } from "./settings";
import type { SettingsOverrides } from "@/lib/settings";

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

// Synthetic data generator limits. Read lazily so tests (and ops) can change them. With a
// database state they include any values saved from the UI; without one, just env/defaults.
export const generatorLimits = (state?: { settings?: SettingsOverrides }) => effectiveSettings(state?.settings).generator;
