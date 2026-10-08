const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4100);
const API_TOKEN = process.env.API_TOKEN || "demo_elapsed_token";
const publicDir = path.join(__dirname, "public");

let nextId = 7;
let tickets = [
  {
    id: "TCK-1001",
    title: "Cannot access billing dashboard",
    description: "User receives a 403 after signing in.",
    status: "open",
    priority: "high",
    created_at: "2026-10-08T08:15:00.000Z",
    updated_at: "2026-10-08T09:30:00.000Z",
    resolved_at: null,
    requester: { id: "usr-11", name: "Mona Hassan", email: "mona@example.com" },
    customer: { id: "org-1", name: "Acme Egypt" },
    assignee: { id: "agent-2", name: "Omar Adel" },
    url: "https://tickets.example.test/TCK-1001",
  },
  {
    id: "TCK-1002",
    title: "Export report is missing rows",
    description: "CSV export has fewer rows than the report view.",
    status: "pending",
    priority: "normal",
    created_at: "2026-10-08T10:05:00.000Z",
    updated_at: "2026-10-09T00:05:00.000Z",
    resolved_at: null,
    requester: { id: "usr-12", name: "Karim Ali", email: "karim@example.com" },
    customer: { id: "org-2", name: "Northstar Labs" },
    assignee: { id: "agent-1", name: "Sara Mostafa" },
    url: "https://tickets.example.test/TCK-1002",
  },
  {
    id: "TCK-1003",
    title: "Password reset email delayed",
    description: "Reset email arrived after 20 minutes.",
    status: "solved",
    priority: "low",
    created_at: "2026-10-07T07:00:00.000Z",
    updated_at: "2026-10-08T11:20:00.000Z",
    resolved_at: "2026-10-08T11:20:00.000Z",
    requester: {
      id: "usr-13",
      name: "Laila Nabil",
      email: "laila@example.com",
    },
    customer: { id: "org-1", name: "Acme Egypt" },
    assignee: { id: "agent-3", name: "Hany Fawzy" },
    url: "https://tickets.example.test/TCK-1003",
  },
  {
    id: "TCK-1004",
    title: "Mobile app crashes on launch",
    description: "Crash started after version 5.8.1.",
    status: "open",
    priority: "urgent",
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:10:00.000Z",
    resolved_at: null,
    requester: { id: "usr-14", name: "Nour Samir", email: "nour@example.com" },
    customer: { id: "org-3", name: "Delta Retail" },
    assignee: { id: "agent-2", name: "Omar Adel" },
    url: "https://tickets.example.test/TCK-1004",
  },
  {
    id: "TCK-1005",
    title: "Need invoice for September",
    description: "Please send a tax invoice for September.",
    status: "closed",
    priority: "normal",
    created_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-05T15:00:00.000Z",
    resolved_at: "2026-10-05T15:00:00.000Z",
    requester: { id: "usr-15", name: "Amr Saeed", email: "amr@example.com" },
    customer: { id: "org-2", name: "Northstar Labs" },
    assignee: { id: "agent-1", name: "Sara Mostafa" },
    url: "https://tickets.example.test/TCK-1005",
  },
  {
    id: "TCK-1006",
    title: "API returns intermittent 502",
    description: "Intermittent gateway errors from the partner API.",
    status: "in_progress",
    priority: "high",
    created_at: "2026-10-09T00:15:00.000Z",
    updated_at: "2026-10-09T00:20:00.000Z",
    resolved_at: null,
    requester: {
      id: "usr-16",
      name: "Salma Fathy",
      email: "salma@example.com",
    },
    customer: { id: "org-3", name: "Delta Retail" },
    assignee: { id: "agent-4", name: "Mariam Tarek" },
    url: "https://tickets.example.test/TCK-1006",
  },
];

const events = [
  {
    id: "evt-1",
    ticket_id: "TCK-1001",
    type: "created",
    created_at: "2026-10-08T08:15:00.000Z",
    author: { id: "usr-11", name: "Mona Hassan" },
    body: "Ticket created",
  },
  {
    id: "evt-2",
    ticket_id: "TCK-1001",
    type: "status_changed",
    created_at: "2026-10-08T09:30:00.000Z",
    author: { id: "agent-2", name: "Omar Adel" },
    body: "Status changed to open",
  },
  {
    id: "evt-3",
    ticket_id: "TCK-1002",
    type: "created",
    created_at: "2026-10-08T10:05:00.000Z",
    author: { id: "usr-12", name: "Karim Ali" },
    body: "Ticket created",
  },
  {
    id: "evt-4",
    ticket_id: "TCK-1003",
    type: "status_changed",
    created_at: "2026-10-08T11:20:00.000Z",
    author: { id: "agent-3", name: "Hany Fawzy" },
    body: "Ticket solved",
  },
];

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
      if (raw.length > 1e6) reject(new Error("Body too large"));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (url.pathname === "/health")
    return send(res, 200, {
      ok: true,
      provider: "Acme Desk (Demo)",
      version: "1.0.0",
    });
  if (url.pathname.startsWith("/api/") && !authorized(req))
    return send(res, 401, {
      error: "unauthorized",
      message: "Use Authorization: Bearer <API_TOKEN>.",
    });
  if (url.pathname === "/api/meta")
    return send(res, 200, {
      provider: "Acme Desk (Demo)",
      api_version: "v1",
      capabilities: ["tickets", "events", "pagination", "updated_since"],
      auth: "bearer",
    });

  if (url.pathname === "/api/tickets" && req.method === "GET") {
    let result = [...tickets];
    const updatedSince = url.searchParams.get("updated_since");
    const status = url.searchParams.get("status");
    const q = (url.searchParams.get("q") || "").toLowerCase();
    if (updatedSince)
      result = result.filter((t) => t.updated_at > updatedSince);
    if (status) result = result.filter((t) => t.status === status);
    if (q)
      result = result.filter((t) =>
        `${t.id} ${t.title} ${t.description}`.toLowerCase().includes(q),
      );
    result.sort((a, b) => a.id.localeCompare(b.id));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || 3)),
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
      : send(res, 404, { error: "not_found", message: "Ticket not found" });
  }
  if (url.pathname === "/api/events" && req.method === "GET") {
    let result = [...events];
    const ticketId = url.searchParams.get("ticket_id");
    if (ticketId) result = result.filter((e) => e.ticket_id === ticketId);
    return send(res, 200, { data: { items: result, total: result.length } });
  }
  if (url.pathname === "/api/tickets" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (!body.title || !body.requester?.email)
        return send(res, 400, {
          error: "validation_error",
          message: "title and requester.email are required",
        });
      const now = new Date().toISOString();
      const id = `TCK-${1000 + nextId++}`;
      const ticket = {
        id,
        title: body.title,
        description: body.description || "",
        status: body.status || "open",
        priority: body.priority || "normal",
        created_at: now,
        updated_at: now,
        resolved_at: null,
        requester: body.requester,
        customer: body.customer || { id: "org-demo", name: "Demo Customer" },
        assignee: body.assignee || null,
        url: `https://tickets.example.test/${id}`,
      };
      tickets.unshift(ticket);
      events.push({
        id: `evt-${events.length + 1}`,
        ticket_id: id,
        type: "created",
        created_at: now,
        author: {
          id: ticket.requester.id || "requester",
          name: ticket.requester.name || ticket.requester.email,
        },
        body: "Ticket created",
      });
      return send(res, 201, { data: ticket });
    } catch (e) {
      return send(res, 400, { error: "bad_request", message: e.message });
    }
  }
  if (ticketMatch && req.method === "PATCH") {
    try {
      const ticket = matchTicket(decodeURIComponent(ticketMatch[1]));
      if (!ticket)
        return send(res, 404, {
          error: "not_found",
          message: "Ticket not found",
        });
      const patch = await readBody(req);
      Object.assign(ticket, patch, { updated_at: new Date().toISOString() });
      return send(res, 200, { data: ticket });
    } catch (e) {
      return send(res, 400, { error: "bad_request", message: e.message });
    }
  }
  if (url.pathname === "/api/events" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (!body.ticket_id || !matchTicket(body.ticket_id))
        return send(res, 400, {
          error: "validation_error",
          message: "ticket_id must reference an existing ticket",
        });
      const event = {
        id: `evt-${events.length + 1}`,
        type: body.type || "comment",
        created_at: new Date().toISOString(),
        author: body.author || { id: "agent-demo", name: "Demo Agent" },
        body: body.body || "",
        ticket_id: body.ticket_id,
      };
      events.push(event);
      return send(res, 201, { data: event });
    } catch (e) {
      return send(res, 400, { error: "bad_request", message: e.message });
    }
  }
  if (url.pathname === "/api/reset" && req.method === "POST") {
    return send(res, 403, {
      error: "disabled",
      message: "Restart the app to reset the in-memory demo data.",
    });
  }
  if (url.pathname.startsWith("/api/"))
    return send(res, 404, {
      error: "not_found",
      message: "Unknown API endpoint",
    });

  const filePath =
    url.pathname === "/"
      ? path.join(publicDir, "index.html")
      : path.join(publicDir, path.basename(url.pathname));
  if (!filePath.startsWith(publicDir))
    return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const ext = path.extname(filePath);
    const mime =
      ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8";
    send(res, 200, data.toString(), mime);
  });
});
server.listen(PORT, "0.0.0.0", () =>
  console.log(
    `Acme Desk demo running on http://localhost:${PORT} (token: ${API_TOKEN})`,
  ),
);
