import { api, json, preflight } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = api(() =>
  json({
    provider: "Acme Desk (Demo)",
    api_version: "v1",
    capabilities: ["tickets", "comments", "status_history", "events", "pagination", "updated_since"],
    auth: "bearer",
  }),
);
