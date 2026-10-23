import { withDb } from "@/lib/server/db";
import { api, json, parseBody, preflight, readText } from "@/lib/server/http";
import { getTicket, patchTicket } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Params = { id: string };

export const GET = api<Params>(async (_req, { params }) => {
  const { id } = await params;

  return json({ data: await withDb(false, (state) => getTicket(state, id)) });
});

export const PATCH = api<Params>(async (req, { params }) => {
  const { id } = await params;
  const raw = await readText(req);

  // The ticket must exist before a malformed body is reported, as before.
  return json({
    data: await withDb(true, (state) => {
      getTicket(state, id);
      return patchTicket(state, id, parseBody(raw));
    }),
  });
});
