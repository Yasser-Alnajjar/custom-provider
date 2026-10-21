const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4100);
const API_TOKEN = process.env.API_TOKEN || "demo_elapsed";
const publicDir = path.join(__dirname, "public");

// Redis (Upstash REST API) holds the database when configured. This is what makes
// Vercel work: every serverless instance reads and writes the same key. Vercel's
// Upstash integration sets KV_REST_API_*, Upstash itself UPSTASH_REDIS_REST_*.
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const REDIS_KEY = process.env.REDIS_KEY || "acmedesk:db";

// Otherwise a JSON file. On Vercel the project files are read-only, so /tmp is
// the only writable place (and it does not outlive the function instance).
const DB_FILE =
  process.env.DB_FILE ||
  (process.env.VERCEL
    ? "/tmp/db.json"
    : path.join(__dirname, "data", "db.json"));

const STATUSES = ["new", "open", "pending", "in_progress", "solved", "closed"];
const RESOLVED = ["solved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const ROLES = ["customer", "agent", "system"];

const SYSTEM = { id: "system", name: "System", role: "system" };

const asAgent = (a) => (a ? { id: a.id, name: a.name, role: "agent" } : SYSTEM);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let evtSeq = 0;
let tickets = [];
let events = [];
let nextNum = 1001;

function addEvent(ticketId, type, at, fields) {
  const event = {
    id: `evt-${++evtSeq}`,
    ticket_id: ticketId,
    type,
    created_at: new Date(at).toISOString(),
    ...fields,
  };

  events.push(event);
  return event;
}

// ---------------------------------------------------------------------------
// Database (Redis or JSON file)
// ---------------------------------------------------------------------------

class StorageError extends Error {}

// Another instance saved the database after this request loaded it.
class ConflictError extends StorageError {}

const DB_NAME = REDIS_URL ? `Redis key ${REDIS_KEY}` : DB_FILE;
const REV_KEY = `${REDIS_KEY}:rev`;

// Saves only if the revision is still the one we loaded, then bumps it.
const SAVE_SCRIPT = `
if (redis.call("GET", KEYS[2]) or "0") ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return redis.call("INCR", KEYS[2])`;

let loadedRev = "0";

async function redis(command) {
  let res;

  try {
    res = await fetch(REDIS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      body: JSON.stringify(command),
    });
  } catch (e) {
    throw new StorageError(`Redis: ${e.cause?.code || e.message}`);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.error) {
    throw new StorageError(`Redis: ${data?.error || `HTTP ${res.status}`}`);
  }

  return data.result;
}

async function saveDb() {
  const raw = JSON.stringify({ evtSeq, nextNum, tickets, events }, null, 2);

  if (REDIS_URL) {
    const rev = await redis([
      "EVAL",
      SAVE_SCRIPT,
      "2",
      REDIS_KEY,
      REV_KEY,
      loadedRev,
      raw,
    ]);

    if (!rev)
      throw new ConflictError("Redis: the database changed during the request");
    loadedRev = String(rev);
    return;
  }

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  // Write to a temp file and rename so a crash never leaves a half-written db.
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, raw);
  fs.renameSync(tmp, DB_FILE);
}

// Replaces the in-memory state with the stored database (empty if none yet).
async function loadDb() {
  let raw = null;

  if (REDIS_URL) {
    const [value, rev] = await redis(["MGET", REDIS_KEY, REV_KEY]);

    raw = value;
    loadedRev = rev || "0";
  } else {
    try {
      raw = fs.readFileSync(DB_FILE, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }

  const db = raw
    ? JSON.parse(raw)
    : { evtSeq: 0, nextNum: 1001, tickets: [], events: [] };

  if (!Array.isArray(db.tickets) || !Array.isArray(db.events)) {
    throw new Error(`${DB_NAME} is not a valid database`);
  }

  ({ evtSeq, nextNum, tickets, events } = db);
  return Boolean(raw);
}

// API requests run one at a time, so a request never loads the database while
// another is between changing the state and saving it.
let queue = Promise.resolve();

function serialized(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  });

  res.end(
    type.startsWith("application/json") ? JSON.stringify(body, null, 2) : body,
  );
}

// Cached on the request, so a retried request reads the same body again.
function readBody(req) {
  req.parsedBody ??= new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 1e6) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });

  return req.parsedBody;
}

function authorized(req) {
  return (
    req.headers.authorization === `Bearer ${API_TOKEN}` ||
    req.headers["x-api-key"] === API_TOKEN
  );
}

function matchTicket(id) {
  return tickets.find((t) => t.id === id);
}

function invalid(res, message) {
  return send(res, 400, { error: "validation_error", message });
}

function setStatus(ticket, next, author) {
  if (next === ticket.status) return;

  const now = Date.now();

  addEvent(ticket.id, "status_changed", now, {
    author: author || asAgent(ticket.assignee),
    public: false,
    from: ticket.status,
    to: next,
    body: `Status changed from ${ticket.status} to ${next}`,
  });

  if (RESOLVED.includes(next)) {
    if (!ticket.resolved_at) {
      ticket.resolved_at = new Date(now).toISOString();
    }
  } else {
    ticket.resolved_at = null;
  }

  ticket.status = next;
  ticket.updated_at = new Date(now).toISOString();
}

function elapsedConfig(origin) {
  return {
    schemaVersion: 1,
    displayName: "Acme Desk (Demo)",
    connection: { baseUrl: origin },
    auth: { type: "bearer" },
    tickets: {
      request: {
        method: "GET",
        path: "/api/tickets",
        query: { updated_since: "{{updatedSince}}" },
      },
      itemsPath: "$.data.items[*]",
      pagination: {
        type: "page",
        param: "page",
        startAt: 1,
        sizeParam: "limit",
        pageSize: 50,
      },
      incremental: { format: "iso8601", lookbackSeconds: 300 },
    },
    comments: {
      request: {
        method: "GET",
        path: "/api/tickets/{{ticket.id}}/comments",
      },
      itemsPath: "$.data.items[*]",
      pagination: { type: "none" },
    },
    statusHistory: {
      request: {
        method: "GET",
        path: "/api/tickets/{{ticket.id}}/history",
      },
      itemsPath: "$.data.items[*]",
      pagination: { type: "none" },
      mapping: {
        id: "$.id",
        changedAt: "$.created_at",
        toStatus: "$.to",
        fromStatus: "$.from",
      },
    },
    mapping: {
      id: "$.id",
      createdAt: "$.created_at",
      status: "$.status",
      title: "$.title",
      priority: "$.priority",
      updatedAt: "$.updated_at",
      customerId: "$.customer.id",
      customerName: "$.customer.name",
      closedAt: "$.resolved_at",
      tags: "$.tags",
      channel: "$.channel",
    },
    commentMapping: {
      id: "$.id",
      createdAt: "$.created_at",
      authorRole: "$.author.role",
      isPublic: "$.public",
      body: "$.body",
      authorName: "$.author.name",
    },
    valueMaps: {
      status: {
        new: "new",
        open: "open",
        pending: "pending_customer",
        in_progress: "in_progress",
        solved: "resolved",
        closed: "closed",
      },
      priority: {
        low: "low",
        normal: "normal",
        high: "high",
        urgent: "urgent",
      },
      authorRole: {
        customer: "customer",
        agent: "agent",
        system: "system",
      },
    },
    unknownStatus: "fail",
    importWindowDays: 90,
    slaMode: "full",
    creationActor: { type: "first_comment_author" },
    ticketUrlTemplate: `http://127.0.0.1:${PORT}/tickets/{id}`,
  };
}

// ---------------------------------------------------------------------------
// API routes (the database is loaded before each request)
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  if (url.pathname === "/api/meta") {
    return send(res, 200, {
      provider: "Acme Desk (Demo)",
      api_version: "v1",
      capabilities: [
        "tickets",
        "comments",
        "status_history",
        "events",
        "pagination",
        "updated_since",
      ],
      auth: "bearer",
    });
  }

  if (url.pathname === "/api/tickets" && req.method === "GET") {
    let result = [...tickets];

    const updatedSince = url.searchParams.get("updated_since");
    const status = url.searchParams.get("status");
    const q = (url.searchParams.get("q") || "").toLowerCase();

    if (updatedSince) {
      const since = Date.parse(updatedSince);

      if (Number.isNaN(since)) {
        return invalid(res, "updated_since must be an ISO 8601 date");
      }

      result = result.filter((t) => Date.parse(t.updated_at) > since);
    }

    if (status) {
      result = result.filter((t) => t.status === status);
    }

    if (q) {
      result = result.filter((t) =>
        `${t.id} ${t.title} ${t.description}`.toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => a.id.localeCompare(b.id));

    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || 20)),
    );

    const total = result.length;
    const items = result.slice((page - 1) * limit, page * limit);

    return send(res, 200, {
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
          next_page: page * limit < total ? page + 1 : null,
        },
      },
    });
  }

  const ticketMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);

  if (ticketMatch && req.method === "GET") {
    const ticket = matchTicket(decodeURIComponent(ticketMatch[1]));

    return ticket
      ? send(res, 200, { data: ticket })
      : send(res, 404, {
          error: "not_found",
          message: "Ticket not found",
        });
  }

  const childMatch = url.pathname.match(
    /^\/api\/tickets\/([^/]+)\/(comments|history)$/,
  );

  if (childMatch && req.method === "GET") {
    const id = decodeURIComponent(childMatch[1]);

    if (!matchTicket(id)) {
      return send(res, 404, {
        error: "not_found",
        message: "Ticket not found",
      });
    }

    const type = childMatch[2] === "comments" ? "comment" : "status_changed";

    const items = events
      .filter((e) => e.ticket_id === id && e.type === type)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    return send(res, 200, { data: { items, total: items.length } });
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    let result = [...events];

    const ticketId = url.searchParams.get("ticket_id");
    const type = url.searchParams.get("type");

    if (ticketId) {
      result = result.filter((e) => e.ticket_id === ticketId);
    }

    if (type) {
      result = result.filter((e) => e.type === type);
    }

    return send(res, 200, {
      data: { items: result, total: result.length },
    });
  }

  if (url.pathname === "/api/tickets" && req.method === "POST") {
    try {
      const body = await readBody(req);

      if (
        !body.title ||
        !body.requester?.email ||
        !body.status ||
        !body.priority
      ) {
        return send(res, 400, {
          error: "validation_error",
          message: "title, requester.email, status, and priority are required",
        });
      }

      const status = body.status;
      const priority = body.priority;

      if (!STATUSES.includes(status)) {
        return invalid(res, `status must be one of ${STATUSES.join(", ")}`);
      }

      if (!PRIORITIES.includes(priority)) {
        return invalid(res, `priority must be one of ${PRIORITIES.join(", ")}`);
      }

      if (body.tags !== undefined && !Array.isArray(body.tags)) {
        return invalid(res, "tags must be an array");
      }

      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const id = `TCK-${nextNum++}`;

      const ticket = {
        id,
        title: body.title,
        description: body.description ?? null,
        status: "new",
        priority,
        created_at: now,
        updated_at: now,
        resolved_at: null,
        requester: body.requester,
        customer: body.customer ?? null,
        assignee: body.assignee ?? null,
        tags: body.tags ?? [],
        channel: body.channel ?? null,
        url: body.url ?? null,
      };

      tickets.unshift(ticket);

      const author = {
        id: body.requester.id ?? null,
        name: body.requester.name ?? null,
        role: "customer",
      };

      addEvent(id, "created", nowMs, {
        author,
        public: true,
        body: "Ticket created",
      });

      if (ticket.description) {
        addEvent(id, "comment", nowMs + 1, {
          author,
          public: true,
          body: ticket.description,
        });
      }

      setStatus(ticket, status, SYSTEM);
      await saveDb();

      return send(res, 201, { data: ticket });
    } catch (e) {
      if (e instanceof StorageError) throw e;
      return send(res, 400, {
        error: "bad_request",
        message: e.message,
      });
    }
  }

  if (ticketMatch && req.method === "PATCH") {
    try {
      const ticket = matchTicket(decodeURIComponent(ticketMatch[1]));

      if (!ticket) {
        return send(res, 404, {
          error: "not_found",
          message: "Ticket not found",
        });
      }

      const patch = await readBody(req);

      if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
        return invalid(res, `status must be one of ${STATUSES.join(", ")}`);
      }

      if (
        patch.priority !== undefined &&
        !PRIORITIES.includes(patch.priority)
      ) {
        return invalid(res, `priority must be one of ${PRIORITIES.join(", ")}`);
      }

      if (patch.title !== undefined && !String(patch.title).trim()) {
        return invalid(res, "title cannot be empty");
      }

      if (
        patch.tags !== undefined &&
        !(
          Array.isArray(patch.tags) &&
          patch.tags.every((t) => typeof t === "string")
        )
      ) {
        return invalid(res, "tags must be an array of strings");
      }

      for (const key of [
        "title",
        "description",
        "priority",
        "requester",
        "customer",
        "assignee",
        "tags",
        "channel",
      ]) {
        if (patch[key] !== undefined) {
          ticket[key] = patch[key];
        }
      }

      ticket.updated_at = new Date().toISOString();

      if (patch.status !== undefined) {
        setStatus(ticket, patch.status);
      }

      await saveDb();

      return send(res, 200, { data: ticket });
    } catch (e) {
      if (e instanceof StorageError) throw e;
      return send(res, 400, {
        error: "bad_request",
        message: e.message,
      });
    }
  }

  if (url.pathname === "/api/events" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const ticket = body.ticket_id && matchTicket(body.ticket_id);

      if (!ticket) {
        return invalid(res, "ticket_id must reference an existing ticket");
      }

      if ((body.type || "comment") !== "comment") {
        return invalid(
          res,
          "only comments can be added; status changes are recorded by PATCH /api/tickets/:id",
        );
      }

      if (!String(body.body || "").trim()) {
        return invalid(res, "body is required");
      }

      const role = body.author?.role || "agent";

      if (!ROLES.includes(role)) {
        return invalid(res, `author.role must be one of ${ROLES.join(", ")}`);
      }

      const event = addEvent(ticket.id, "comment", Date.now(), {
        author: {
          id:
            body.author?.id || (role === "agent" ? "agent-demo" : "requester"),
          name:
            body.author?.name || (role === "agent" ? "Demo Agent" : "Customer"),
          role,
        },
        public: body.public !== false,
        body: String(body.body),
      });

      ticket.updated_at = event.created_at;
      await saveDb();

      return send(res, 201, { data: event });
    } catch (e) {
      if (e instanceof StorageError) throw e;
      return send(res, 400, {
        error: "bad_request",
        message: e.message,
      });
    }
  }

  if (url.pathname === "/api/reset" && req.method === "POST") {
    return send(res, 403, {
      error: "disabled",
      message:
        "Delete the database file (DB_FILE) and restart the app to reset the data.",
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return send(res, 404, {
      error: "not_found",
      message: "Unknown API endpoint",
    });
  }
}

// ---------------------------------------------------------------------------
// Request handler (used by `node server.js` locally and by api/index.js on Vercel)
// ---------------------------------------------------------------------------

// Behind a proxy (Vercel) the original protocol and host arrive as forwarded headers.
const firstHeader = (value) =>
  value ? String(value).split(",")[0].trim() : "";

async function handleRequest(req, res) {
  const protocol =
    firstHeader(req.headers["x-forwarded-proto"]) ||
    (req.socket?.encrypted ? "https" : "http");
  const hostHeader =
    firstHeader(req.headers["x-forwarded-host"]) ||
    req.headers.host ||
    `127.0.0.1:${PORT}`;

  const url = new URL(req.url, `${protocol}://${hostHeader}`);

  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      provider: "Acme Desk (Demo)",
      version: "1.1.0",
    });
  }

  if (url.pathname === "/elapsed-config.json") {
    const host = hostHeader.replace(/^localhost(?=:|$)/, "127.0.0.1");

    return send(res, 200, elapsedConfig(`${protocol}://${host}`));
  }

  if (url.pathname.startsWith("/api/") && !authorized(req)) {
    return send(res, 401, {
      error: "unauthorized",
      message: "Use Authorization: Bearer <API_TOKEN>.",
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return serialized(async () => {
      try {
        // A conflict is thrown before the response is sent, so the request
        // can run again on the newer data.
        for (let attempt = 1; ; attempt++) {
          try {
            await loadDb();
            return await handleApi(req, res, url);
          } catch (e) {
            if (!(e instanceof ConflictError) || attempt === 5) throw e;
          }
        }
      } catch (e) {
        if (!(e instanceof StorageError)) throw e;

        return send(res, 503, {
          error: "storage_unavailable",
          message: e.message,
        });
      }
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
  }

  let decoded;

  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad request", "text/plain; charset=utf-8");
  }

  const ext = path.extname(decoded);

  const filePath = path.join(
    publicDir,
    ext ? path.normalize(decoded) : "index.html",
  );

  if (!filePath.startsWith(publicDir + path.sep)) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    }

    send(
      res,
      200,
      data,
      MIME[path.extname(filePath)] || "application/octet-stream",
    );
  });
}

// ---------------------------------------------------------------------------
// Start a local server when run directly; Vercel imports the handler instead
// ---------------------------------------------------------------------------

module.exports = handleRequest;

if (require.main === module) {
  // Use the existing database, or create an empty file. Redis needs nothing
  // created: a missing key reads as an empty database.
  loadDb()
    .then((found) => found || REDIS_URL || saveDb())
    .then(() => {
      http.createServer(handleRequest).listen(PORT, "0.0.0.0", () => {
        console.log(
          `Acme Desk demo running on http://localhost:${PORT}\n` +
            `${tickets.length} tickets, ${events.length} events in ${DB_NAME}.\n` +
            `Elapsed config: http://127.0.0.1:${PORT}/elapsed-config.json`,
        );
      });
    });
}
