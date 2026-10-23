import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { addComment, listEvents } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api(async (req) => {
  const params = new URL(req.url).searchParams;
  const ticketId = params.get("ticket_id");
  const type = params.get("type");

  return json({ data: await withDb(false, (state) => listEvents(state, ticketId, type)) });
});

export const POST = api(async (req) => {
  const body = await readBody(req);

  return json({ data: await withDb(true, (state) => addComment(state, body)) }, 201);
});
