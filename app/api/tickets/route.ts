import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { effectiveSettings } from "@/lib/server/settings";
import { createTicket, listTickets, parseListParams } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api(async (req) => {
  const query = new URL(req.url).searchParams;

  // The page-size limits come from the saved server settings, read with the data in one load.
  return json({ data: await withDb(false, (state) => listTickets(state, parseListParams(query, effectiveSettings(state.settings).api))) });
});

export const POST = api(async (req) => {
  const body = await readBody(req);

  return json({ data: await withDb(true, (state) => createTicket(state, body)) }, 201);
});
