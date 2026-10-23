import { API_TOKEN } from "./config";
import { HttpError, StorageError } from "./errors";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const MAX_BODY = 1e6;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export const errorResponse = (status: number, error: string, message: string) =>
  json({ error, message }, status);

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function isAuthorized(req: Request): boolean {
  return (
    req.headers.get("authorization") === `Bearer ${API_TOKEN}` ||
    req.headers.get("x-api-key") === API_TOKEN
  );
}

/** Reads the raw request body, enforcing the size limit. */
export async function readText(req: Request): Promise<string> {
  const raw = await req.text();

  if (raw.length > MAX_BODY) throw new HttpError(400, "bad_request", "Body too large");
  return raw;
}

/** Parses a JSON object body; an empty body is `{}`. */
export function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad_request", "Invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "Body must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export const readBody = async (req: Request) => parseBody(await readText(req));

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response> | Response;

/** Wraps an /api route: bearer auth, then error mapping to the JSON error shape. */
export function api<P = Record<string, string | string[]>>(handler: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    if (!isAuthorized(req)) {
      return errorResponse(401, "unauthorized", "Use Authorization: Bearer <API_TOKEN>.");
    }

    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message);
      if (e instanceof StorageError) return errorResponse(503, "storage_unavailable", e.message);
      throw e;
    }
  };
}
