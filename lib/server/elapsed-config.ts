/** The Custom REST configuration document that Elapsed imports. */
export function elapsedConfig(origin: string) {
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
      request: { method: "GET", path: "/api/tickets/{{ticket.id}}/comments" },
      itemsPath: "$.data.items[*]",
      pagination: { type: "none" },
    },
    statusHistory: {
      request: { method: "GET", path: "/api/tickets/{{ticket.id}}/history" },
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
      authorRole: { customer: "customer", agent: "agent", system: "system" },
    },
    unknownStatus: "fail",
    importWindowDays: 90,
    slaMode: "full",
    creationActor: { type: "first_comment_author" },
    ticketUrlTemplate: `${origin}/tickets/{id}`,
  };
}

const first = (value: string | null) =>
  value ? value.split(",")[0].trim() : "";

/** Behind a proxy (Vercel) the original protocol and host arrive as forwarded headers. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const protocol =
    first(req.headers.get("x-forwarded-proto")) ||
    url.protocol.replace(":", "");
  const host =
    first(req.headers.get("x-forwarded-host")) ||
    req.headers.get("host") ||
    url.host;

  // Node may resolve `localhost` to IPv6; Elapsed should use the IPv4 literal.
  return `${protocol}://${host.replace(/^localhost(?=:|$)/, "127.0.0.1")}`;
}
