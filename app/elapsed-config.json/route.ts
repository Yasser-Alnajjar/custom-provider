import { elapsedConfig, requestOrigin } from "@/lib/server/elapsed-config";
import { json, preflight } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = (req: Request) => json(elapsedConfig(requestOrigin(req)));
