import { json, preflight } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = () => json({ ok: true, provider: "Acme Desk (Demo)", version: "1.1.0" });
