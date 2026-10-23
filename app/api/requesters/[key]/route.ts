import { preflight } from "@/lib/server/http";
import { itemHandlers } from "@/lib/server/people-routes";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const handlers = itemHandlers("requesters");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
