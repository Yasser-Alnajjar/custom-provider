import { withDb } from "@/lib/server/db";
import { api, json, preflight } from "@/lib/server/http";
import { assertEnabled, touchSynthetic } from "@/lib/server/generator";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Re-stamps synthetic tickets' `updated_at` so Elapsed's next incremental sync picks them up. */
export const POST = api(async () =>
  json({ data: await withDb(true, (state) => (assertEnabled(), touchSynthetic(state))) }),
);
