import { api, errorResponse, preflight } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const unknown = api(() => errorResponse(404, "not_found", "Unknown API endpoint"));

export const GET = unknown;
export const POST = unknown;
export const PATCH = unknown;
export const PUT = unknown;
export const DELETE = unknown;
