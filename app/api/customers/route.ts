import { preflight } from "@/lib/server/http";
import { collectionHandlers } from "@/lib/server/people-routes";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const handlers = collectionHandlers("customers");

export const GET = handlers.GET;
export const POST = handlers.POST;
