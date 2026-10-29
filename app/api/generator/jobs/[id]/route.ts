import { withDb } from "@/lib/server/db";
import { api, json, preflight } from "@/lib/server/http";
import { getJob } from "@/lib/server/generator";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api<{ id: string }>(async (_req, { params }) => {
  const { id } = await params;

  return json({ data: await withDb(false, (state) => getJob(state, id)) });
});
