import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { createJob, listJobs } from "@/lib/server/generator";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api(async () => json({ data: await withDb(false, listJobs) }));

export const POST = api(async (req) => {
  const body = await readBody(req);
  const { job, reused } = await withDb(true, (state) => createJob(state, body));

  return json({ data: job, reused }, reused ? 200 : 201);
});
