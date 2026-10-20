const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4100);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || "./certs/localhost-key.pem";

const SSL_CERT_PATH = process.env.SSL_CERT_PATH || "./certs/localhost-cert.pem";

const API_TOKEN = process.env.API_TOKEN || "demo_elapsed_token";
const publicDir = path.join(__dirname, "public");

const MIN = 60_000;
const NOW = Date.now();
const iso = (ms) => new Date(Math.min(ms, Date.now())).toISOString();

const STATUSES = ["new", "open", "pending", "in_progress", "solved", "closed"];
const RESOLVED = ["solved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const ROLES = ["customer", "agent", "system"];

const CUSTOMERS = [
  { id: "org-1", name: "Acme Egypt" },
  { id: "org-2", name: "Northstar Labs" },
  { id: "org-3", name: "Delta Retail" },
  { id: "org-4", name: "Horizon Telecom" },
  { id: "org-5", name: "Blue Nile Logistics" },
];

const REQUESTERS = {
  "org-1": [
    { id: "usr-11", name: "Mona Hassan", email: "mona@example.com" },
    { id: "usr-13", name: "Laila Nabil", email: "laila@example.com" },
  ],
  "org-2": [
    { id: "usr-12", name: "Karim Ali", email: "karim@example.com" },
    { id: "usr-15", name: "Amr Saeed", email: "amr@example.com" },
  ],
  "org-3": [
    { id: "usr-14", name: "Nour Samir", email: "nour@example.com" },
    { id: "usr-16", name: "Salma Fathy", email: "salma@example.com" },
  ],
  "org-4": [
    { id: "usr-17", name: "Youssef Gamal", email: "youssef@example.com" },
    { id: "usr-18", name: "Dina Farouk", email: "dina@example.com" },
  ],
  "org-5": [
    { id: "usr-19", name: "Tamer Wahba", email: "tamer@example.com" },
    { id: "usr-20", name: "Heba Ragab", email: "heba@example.com" },
  ],
};

const AGENTS = [
  { id: "agent-1", name: "Sara Mostafa" },
  { id: "agent-2", name: "Omar Adel" },
  { id: "agent-3", name: "Hany Fawzy" },
  { id: "agent-4", name: "Mariam Tarek" },
];

const SYSTEM = { id: "system", name: "System", role: "system" };

const asAgent = (a) => (a ? { id: a.id, name: a.name, role: "agent" } : SYSTEM);

const asCustomer = (r) => ({
  id: r.id || "requester",
  name: r.name || r.email,
  role: "customer",
});

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

let evtSeq = 0;
let tickets = [];
let events = [];

function addEvent(ticketId, type, at, fields) {
  const event = {
    id: `evt-${++evtSeq}`,
    ticket_id: ticketId,
    type,
    created_at: iso(at),
    ...fields,
  };

  events.push(event);
  return event;
}

function seedTicket(spec) {
  const created = NOW - spec.ageMin * MIN;
  const requester = REQUESTERS[spec.customer.id][spec.requesterIdx || 0];
  const assignee = spec.agentIdx == null ? null : AGENTS[spec.agentIdx];
  const customerAuthor = asCustomer(requester);
  const agentAuthor = asAgent(assignee);
  const id = spec.id;
  let last = created;

  const touch = (at) => (last = Math.max(last, Math.min(at, NOW)));

  addEvent(id, "created", created, {
    author: customerAuthor,
    public: true,
    body: "Ticket created",
  });

  addEvent(id, "comment", created + 30_000, {
    author: customerAuthor,
    public: true,
    body: spec.description,
  });

  const move = (from, to, at, author = agentAuthor) => {
    addEvent(id, "status_changed", at, {
      author,
      public: false,
      from,
      to,
      body: `Status changed from ${from} to ${to}`,
    });

    touch(at);
  };

  if (spec.status !== "new") {
    move("new", "open", created + 2 * MIN, SYSTEM);
  }

  let replyAt = null;

  if (spec.firstReplyMin != null) {
    replyAt = created + spec.firstReplyMin * MIN;

    addEvent(id, "comment", replyAt, {
      author: agentAuthor,
      public: true,
      body: "Thanks for reaching out. We are looking into this now.",
    });

    touch(replyAt);

    if (spec.note) {
      addEvent(id, "comment", replyAt + MIN, {
        author: agentAuthor,
        public: false,
        body: "Internal note: checked the account, escalating if it repeats.",
      });

      touch(replyAt + MIN);
    }
  }

  let state = spec.status === "new" ? "new" : "open";

  if (spec.pendingCycle && replyAt != null && spec.status !== "pending") {
    move("open", "pending", replyAt + 2 * MIN);

    const back = replyAt + 90 * MIN;

    addEvent(id, "comment", back, {
      author: customerAuthor,
      public: true,
      body: "Here is the extra information you asked for.",
    });

    touch(back);
    move("pending", "open", back + MIN, SYSTEM);
  }

  if (spec.status === "pending") {
    move("open", "pending", (replyAt ?? created) + 2 * MIN);
    state = "pending";
  } else if (spec.status === "in_progress") {
    move("open", "in_progress", (replyAt ?? created) + 5 * MIN);
    state = "in_progress";
  } else if (RESOLVED.includes(spec.status)) {
    const resolvedAt = created + spec.resolveAfterMin * MIN;

    addEvent(id, "comment", resolvedAt - MIN, {
      author: agentAuthor,
      public: true,
      body: "This is now resolved. Reply if you still see the problem.",
    });

    move("open", "solved", resolvedAt);
    state = "solved";
    spec.resolvedAt = resolvedAt;

    if (spec.status === "closed") {
      move("solved", "closed", resolvedAt + 1440 * MIN, SYSTEM);
      state = "closed";
    }
  }

  if (state !== spec.status) {
    throw new Error(`seed ${id}: ended in ${state}, wanted ${spec.status}`);
  }

  tickets.push({
    id,
    title: spec.title,
    description: spec.description,
    status: spec.status,
    priority: spec.priority,
    created_at: iso(created),
    updated_at: iso(last),
    resolved_at: spec.resolvedAt ? iso(spec.resolvedAt) : null,
    requester,
    customer: spec.customer,
    assignee,
    tags: spec.tags || [],
    channel: spec.channel || "email",
    url: `https://tickets.example.test/${id}`,
  });
}

function mulberry32(seed) {
  let a = seed;

  return () => {
    a |= 0x0;
    a = (a + 0x6d2b79f5) | 0;

    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  ["Cannot access billing dashboard", ["billing", "access"]],
  ["Export report is missing rows", ["reports", "bug"]],
  ["Password reset email delayed", ["email", "auth"]],
  ["Mobile app crashes on launch", ["mobile", "bug"]],
  ["Need invoice for September", ["billing"]],
  ["API returns intermittent 502", ["api", "bug"]],
  ["Webhook deliveries are duplicated", ["api", "webhooks"]],
  ["SSO login loops back to sign-in", ["auth", "sso"]],
  ["Dashboard charts load slowly", ["performance"]],
  ["Add a user to our workspace", ["admin"]],
  ["Two-factor code never arrives", ["auth", "sms"]],
  ["Refund for duplicate charge", ["billing", "refund"]],
  ["CSV import rejects valid dates", ["import", "bug"]],
  ["Request: dark mode for the portal", ["feature-request"]],
  ["Notification emails go to spam", ["email"]],
  ["Cannot change the account owner", ["admin"]],
  ["Search returns stale results", ["search", "bug"]],
  ["Rate limit hit during nightly sync", ["api", "limits"]],
  ["Update billing contact details", ["billing", "admin"]],
  ["Scheduled report did not run", ["reports"]],
];

const CURATED = [
  {
    id: "TCK-1001",
    title: TITLES[0][0],
    description: "User receives a 403 after signing in.",
    status: "open",
    priority: "high",
    ageMin: 16 * 60,
    firstReplyMin: 75,
    note: true,
    customer: CUSTOMERS[0],
    requesterIdx: 0,
    agentIdx: 1,
    tags: TITLES[0][1],
    channel: "email",
  },
  {
    id: "TCK-1002",
    title: TITLES[1][0],
    description: "CSV export has fewer rows than the report view.",
    status: "pending",
    priority: "normal",
    ageMin: 38 * 60,
    firstReplyMin: 40,
    customer: CUSTOMERS[1],
    requesterIdx: 0,
    agentIdx: 0,
    tags: TITLES[1][1],
    channel: "web",
  },
  {
    id: "TCK-1003",
    title: TITLES[2][0],
    description: "Reset email arrived after 20 minutes.",
    status: "solved",
    priority: "low",
    ageMin: 66 * 60,
    firstReplyMin: 55,
    resolveAfterMin: 28 * 60,
    pendingCycle: true,
    customer: CUSTOMERS[0],
    requesterIdx: 1,
    agentIdx: 2,
    tags: TITLES[2][1],
    channel: "email",
  },
  {
    id: "TCK-1004",
    title: TITLES[3][0],
    description: "Crash started after version 5.8.1.",
    status: "open",
    priority: "urgent",
    ageMin: 30,
    firstReplyMin: null,
    customer: CUSTOMERS[2],
    requesterIdx: 0,
    agentIdx: 1,
    tags: TITLES[3][1],
    channel: "chat",
  },
  {
    id: "TCK-1005",
    title: TITLES[4][0],
    description: "Please send a tax invoice for September.",
    status: "closed",
    priority: "normal",
    ageMin: 8 * 1440,
    firstReplyMin: 120,
    resolveAfterMin: 4 * 1440,
    customer: CUSTOMERS[1],
    requesterIdx: 1,
    agentIdx: 0,
    tags: TITLES[4][1],
    channel: "email",
  },
  {
    id: "TCK-1006",
    title: TITLES[5][0],
    description: "Intermittent gateway errors from the partner API.",
    status: "in_progress",
    priority: "high",
    ageMin: 3 * 60,
    firstReplyMin: 20,
    note: true,
    customer: CUSTOMERS[2],
    requesterIdx: 1,
    agentIdx: 3,
    tags: TITLES[5][1],
    channel: "web",
  },
];

function seed() {
  evtSeq = 0;
  tickets = [];
  events = [];

  CURATED.forEach((spec) => seedTicket({ ...spec }));

  const rng = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  for (let i = 0; i < 30; i += 1) {
    const ageMin = Math.round(45 + Math.pow(rng(), 1.6) * 40 * 1440);

    let status;

    if (ageMin < 120) {
      status = pick(["new", "open"]);
    } else if (ageMin < 1440) {
      status = pick(["open", "open", "in_progress", "pending", "solved"]);
    } else if (ageMin < 7 * 1440) {
      status = pick([
        "open",
        "pending",
        "in_progress",
        "solved",
        "solved",
        "closed",
      ]);
    } else {
      status = pick(["solved", "closed", "closed", "closed", "open"]);
    }

    const answered = status !== "new" && !(status === "open" && rng() < 0.12);

    const firstReplyMin = answered
      ? Math.min(5 + Math.floor(rng() * 180), ageMin - 5)
      : null;

    const resolveAfterMin = RESOLVED.includes(status)
      ? Math.min(
          ageMin - 2,
          firstReplyMin + 30 + Math.floor(rng() * ageMin * 0.6),
        )
      : null;

    const [title, tags] = TITLES[(i + 6) % TITLES.length];
    const customer = pick(CUSTOMERS);

    seedTicket({
      id: `TCK-${1007 + i}`,
      title,
      description: `${title}. Reported by the customer, details attached to the account.`,
      status,
      priority: pick(["low", "normal", "normal", "high", "urgent"]),
      ageMin,
      firstReplyMin,
      resolveAfterMin,
      pendingCycle: RESOLVED.includes(status) && rng() < 0.3,
      note: rng() < 0.3,
      customer,
      requesterIdx: rng() < 0.5 ? 0 : 1,
      agentIdx: status === "new" ? null : Math.floor(rng() * AGENTS.length),
      tags,
      channel: pick(["email", "chat", "web"]),
    });
  }
}

seed();

let nextNum = 1000 + tickets.length + 1;

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

function readBody(req) {
  return new Promise((resolve, reject) => {
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
    ticketUrlTemplate: "https://tickets.example.test/{id}",
  };
}

// ---------------------------------------------------------------------------
// Shared request handler for HTTP and HTTPS
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const protocol = req.socket.encrypted ? "https" : "http";

  const url = new URL(
    req.url,
    `${protocol}://${req.headers.host || `127.0.0.1:${PORT}`}`,
  );

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
    const host = (req.headers.host || `127.0.0.1:${PORT}`).replace(
      /^localhost(?=:|$)/,
      "127.0.0.1",
    );

    return send(res, 200, elapsedConfig(`${protocol}://${host}`));
  }

  if (url.pathname.startsWith("/api/") && !authorized(req)) {
    return send(res, 401, {
      error: "unauthorized",
      message: "Use Authorization: Bearer <API_TOKEN>.",
    });
  }

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

      return send(res, 201, { data: ticket });
    } catch (e) {
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

      return send(res, 200, { data: ticket });
    } catch (e) {
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

      return send(res, 201, { data: event });
    } catch (e) {
      return send(res, 400, {
        error: "bad_request",
        message: e.message,
      });
    }
  }

  if (url.pathname === "/api/reset" && req.method === "POST") {
    return send(res, 403, {
      error: "disabled",
      message: "Restart the app to reset the in-memory demo data.",
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return send(res, 404, {
      error: "not_found",
      message: "Unknown API endpoint",
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
// Start HTTP and HTTPS servers
// ---------------------------------------------------------------------------

// HTTP works without certificates.
const httpServer = http.createServer(handleRequest);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Acme Desk demo running on http://localhost:${PORT}\n` +
      `${tickets.length} tickets, ${events.length} events.\n` +
      `Elapsed config: http://127.0.0.1:${PORT}/elapsed-config.json`,
  );
});

// HTTPS starts only when both certificate files are configured.
if (SSL_KEY_PATH && SSL_CERT_PATH) {
  try {
    const httpsOptions = {
      key: fs.readFileSync(path.resolve(__dirname, SSL_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, SSL_CERT_PATH)),
    };

    const httpsServer = https.createServer(httpsOptions, handleRequest);

    httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
      console.log(
        `Acme Desk demo running on https://localhost:${HTTPS_PORT}\n` +
          `Elapsed config: https://127.0.0.1:${HTTPS_PORT}/elapsed-config.json`,
      );
    });

    httpsServer.on("error", (error) => {
      console.error("HTTPS server error:", error.message);
    });
  } catch (error) {
    console.error(
      "HTTPS could not start. Check SSL_KEY_PATH and SSL_CERT_PATH:",
      error.message,
    );
  }
} else {
  console.log(
    "HTTPS is disabled. Set SSL_KEY_PATH and SSL_CERT_PATH to enable it.",
  );
}
