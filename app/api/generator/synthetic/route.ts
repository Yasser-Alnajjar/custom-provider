import { withDb } from "@/lib/server/db";
import { api, json, preflight } from "@/lib/server/http";
import { assertEnabled, purgeSynthetic } from "@/lib/server/generator";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Deletes every synthetic ticket (and its events); real tickets are untouched. */
export const DELETE = api(async () =>
  json({ data: await withDb(true, (state) => (assertEnabled(), purgeSynthetic(state))) }),
);
