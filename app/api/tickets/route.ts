import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { createTicket, listTickets, parseListParams } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api(async (req) => {
  const params = parseListParams(new URL(req.url).searchParams);

  return json({ data: await withDb(false, (state) => listTickets(state, params)) });
});

export const POST = api(async (req) => {
  const body = await readBody(req);

  return json({ data: await withDb(true, (state) => createTicket(state, body)) }, 201);
});
