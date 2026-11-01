import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { deleteRandomTickets } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Deletes `count` randomly chosen tickets (and their events). */
export const DELETE = api(async (req) => {
  const body = await readBody(req);

  return json({ data: await withDb(true, (state) => deleteRandomTickets(state, body.count)) });
});
