// Customers, requesters and agents. The API has no endpoints for these, so
// each page is a view over what tickets and events already carry.

import {
  $, esc, plural, timeHtml, toDate, formatDuration, resolutionMs, avatar, statusBadge,
  priorityBadge, pageHead, emptyState, errorState, pager, sortHeader, nextSort, compare,
  readQuery, writeQuery, eventItem, RESOLVED_STATUSES, href, toast,
} from "./lib.js";
import { navigate } from "./router.js";
import {
  requesterKey, store, ensureCore, loadCore, directory, ticketById, lastActivity, customerHref,
  requesterHref, agentHref,
} from "./store.js";

const isOpen = (t) => !RESOLVED_STATUSES.includes(t.status);
function stats(tickets) {
  const durations = tickets.map(resolutionMs).filter((ms) => ms !== null);
  return {
    total: tickets.length,
    open: tickets.filter(isOpen).length,
    resolved: tickets.length - tickets.filter(isOpen).length,
    avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}
const statCards = (items) =>
  `<section class="stats">${items
    .map(([label, value, note]) => `<div class="stat"><div class="stat-top">${esc(label)}</div><strong>${value}</strong><small>${esc(note || "")}</small></div>`)
    .join("")}</section>`;

export function compactTickets(tickets, empty = "No tickets.") {
  if (!tickets.length) return emptyState(empty);
  return `<div class="table-wrap"><table><thead><tr><th>TICKET</th><th>STATUS</th><th>PRIORITY</th><th>ASSIGNEE</th><th>UPDATED</th></tr></thead><tbody>${tickets
    .map(
      (t) => `<tr data-href="${href("tickets", t.id)}">
        <td><a class="ticket-id" href="${href("tickets", t.id)}">${esc(t.id)}</a><div class="ticket-title">${esc(t.title)}</div></td>
        <td>${statusBadge(t.status)}</td><td>${priorityBadge(t.priority)}</td>
        <td>${t.assignee ? `<a href="${agentHref(t.assignee)}">${esc(t.assignee.name)}</a>` : `<span class="person-sub">Unassigned</span>`}</td>
        <td><span class="updated">${timeHtml(t.updated_at)}</span></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
const panel = (title, sub, body, extra = "") =>
  `<section class="panel"><div class="panel-heading"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${extra}</div>${body}</section>`;
const recentEvents = (events, n = 10) =>
  events.length
    ? `<div class="event-list">${events
        .slice()
        .sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0))
        .slice(0, n)
        .map((e) => eventItem(e, { ticket: ticketById(e.ticket_id) }))
        .join("")}</div>`
    : emptyState("No activity recorded.");

function delegateRowClicks(ctx) {
  ctx.view.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a, button")) navigate(row.dataset.href);
  });
}

// ----- generic list ---------------------------------------------------------------------

async function listPage(ctx, cfg) {
  ctx.title(cfg.title);
  const DEFAULTS = { q: "", sort: cfg.sort, page: 1, size: 25 };
  const f = readQuery(DEFAULTS);
  f.page = Math.max(1, Number(f.page) || 1);
  f.size = Number(f.size) || 25;
  if (!cfg.columns.some((c) => c.key === f.sort.split(":")[0])) f.sort = DEFAULTS.sort;

  ctx.view.innerHTML = `${pageHead({
    title: cfg.title,
    subtitle: cfg.subtitle,
    actions: `<button class="btn secondary" data-refresh>↻ Refresh data</button>`,
  })}
  <section class="panel">
    <div class="toolbar"><div class="search">⌕ <input id="q" value="${esc(f.q)}" placeholder="${esc(cfg.placeholder)}"></div><span class="record-count" id="recordCount"></span></div>
    <div id="results"><div class="empty">Loading…</div></div>
  </section>`;
  const results = $("#results", ctx.view);
  const draw = () => {
    writeQuery(f, DEFAULTS);
    if (store.ticketsState === "error" && !store.tickets.length)
      return (results.innerHTML = errorState(`Could not load tickets: ${store.ticketsError}`));
    const all = cfg.items();
    const q = f.q.toLowerCase().trim();
    const [field, dir] = f.sort.split(":");
    const col = cfg.columns.find((c) => c.key === field);
    const list = all
      .filter((x) => !q || cfg.search(x).filter(Boolean).join(" ").toLowerCase().includes(q))
      .sort((a, b) => compare(col.sortValue(a), col.sortValue(b)) * (dir === "desc" ? -1 : 1));
    $("#recordCount", ctx.view).textContent = list.length === all.length ? plural(all.length, cfg.noun) : `${list.length} of ${plural(all.length, cfg.noun)}`;
    f.page = Math.min(f.page, Math.max(1, Math.ceil(list.length / f.size)));
    const rows = list.slice((f.page - 1) * f.size, f.page * f.size);
    results.innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr>${cfg.columns.map((c) => sortHeader(c.label, c.key, f.sort)).join("")}</tr></thead><tbody>${rows
          .map((x) => `<tr data-href="${cfg.href(x)}">${cfg.columns.map((c) => `<td>${c.html(x)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>${pager({ total: list.length, page: f.page, size: f.size })}`
      : emptyState(all.length ? `Nothing matches "${esc(f.q)}".<br><button class="text-btn" data-clear>Clear search</button>` : cfg.empty);
  };
  ctx.view.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-refresh]") || t.closest("[data-retry]")) {
      await loadCore();
      if (ctx.isCurrent()) draw();
      return t.closest("[data-refresh]") && toast("Data refreshed");
    }
    if (t.closest("[data-clear]")) { f.q = ""; $("#q", ctx.view).value = ""; return draw(); }
    const sort = t.closest("[data-sort]");
    if (sort) { f.sort = nextSort(f.sort, sort.dataset.sort, cfg.columns.find((c) => c.key === sort.dataset.sort).desc ? "desc" : "asc"); return draw(); }
    const p = t.closest("[data-page]");
    if (p && !p.disabled) { f.page = Number(p.dataset.page); return draw(); }
  });
  ctx.view.addEventListener("change", (e) => {
    if (e.target.matches("[data-page-size]")) { f.size = Number(e.target.value); f.page = 1; draw(); }
  });
  $("#q", ctx.view).addEventListener("input", (e) => { f.q = e.target.value; f.page = 1; draw(); });
  delegateRowClicks(ctx);
  await ensureCore();
  if (ctx.isCurrent()) draw();
}

const personCell = (name, sub) =>
  `<div class="person">${avatar(name)}<div><div class="person-name">${esc(name)}</div>${sub ? `<div class="person-sub">${esc(sub)}</div>` : ""}</div></div>`;
const ago = (iso) => (iso ? timeHtml(iso) : `<span class="muted">—</span>`);

export const customersPage = (ctx) =>
  listPage(ctx, {
    title: "Customers",
    noun: "customer",
    subtitle: "Organisations that raised tickets. Derived from the <code>customer</code> object on each ticket.",
    placeholder: "Search customers or requesters…",
    sort: "name:asc",
    empty: "No customers yet — they appear as soon as a ticket has one.",
    items: () => [...directory().customers.values()],
    search: (c) => [c.name, c.id, ...[...c.requesters.values()].flatMap((r) => [r.name, r.email])],
    href: (c) => customerHref(c),
    columns: [
      { key: "name", label: "CUSTOMER", sortValue: (c) => c.name.toLowerCase(), html: (c) => personCell(c.name, c.id) },
      { key: "requesters", label: "REQUESTERS", desc: true, sortValue: (c) => c.requesters.size, html: (c) => esc(c.requesters.size) },
      { key: "tickets", label: "TICKETS", desc: true, sortValue: (c) => c.tickets.length, html: (c) => esc(c.tickets.length) },
      { key: "open", label: "OPEN", desc: true, sortValue: (c) => stats(c.tickets).open, html: (c) => esc(stats(c.tickets).open) },
      { key: "avg", label: "AVG. RESOLUTION", sortValue: (c) => stats(c.tickets).avg, html: (c) => { const a = stats(c.tickets).avg; return a == null ? `<span class="muted">—</span>` : esc(formatDuration(a)); } },
      { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (c) => toDate(lastActivity(c.tickets))?.getTime() ?? 0, html: (c) => ago(lastActivity(c.tickets)) },
    ],
  });

export const requestersPage = (ctx) =>
  listPage(ctx, {
    title: "Requesters",
    noun: "requester",
    subtitle: "People who opened tickets. Derived from the <code>requester</code> object on each ticket.",
    placeholder: "Search name, email or customer…",
    sort: "name:asc",
    empty: "No requesters yet.",
    items: () => [...directory().requesters.values()],
    search: (r) => [r.name, r.email, r.id, ...[...r.customers.values()].map((c) => c.name)],
    href: (r) => requesterHref(r),
    columns: [
      { key: "name", label: "REQUESTER", sortValue: (r) => r.name?.toLowerCase(), html: (r) => personCell(r.name, r.email) },
      { key: "customer", label: "CUSTOMER", sortValue: (r) => [...r.customers.values()][0]?.name?.toLowerCase(), html: (r) => [...r.customers.values()].map((c) => `<a href="${customerHref(c)}">${esc(c.name)}</a>`).join(", ") || `<span class="muted">—</span>` },
      { key: "tickets", label: "TICKETS", desc: true, sortValue: (r) => r.tickets.length, html: (r) => esc(r.tickets.length) },
      { key: "open", label: "OPEN", desc: true, sortValue: (r) => stats(r.tickets).open, html: (r) => esc(stats(r.tickets).open) },
      { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (r) => toDate(lastActivity(r.tickets))?.getTime() ?? 0, html: (r) => ago(lastActivity(r.tickets)) },
    ],
  });

const agentStats = (a) => ({
  ...stats(a.tickets),
  publicReplies: a.events.filter((e) => e.type === "comment" && e.public !== false).length,
  notes: a.events.filter((e) => e.type === "comment" && e.public === false).length,
  transitions: a.events.filter((e) => e.type === "status_changed").length,
});
export const agentsPage = (ctx) =>
  listPage(ctx, {
    title: "Agents",
    noun: "agent",
    subtitle: "Everyone who is assigned a ticket or has written as an agent. Derived from <code>assignee</code> and event authors.",
    placeholder: "Search agents…",
    sort: "name:asc",
    empty: "No agents yet.",
    items: () => [...directory().agents.values()],
    search: (a) => [a.name, a.id],
    href: (a) => agentHref(a),
    columns: [
      { key: "name", label: "AGENT", sortValue: (a) => a.name.toLowerCase(), html: (a) => personCell(a.name, a.id) },
      { key: "assigned", label: "ASSIGNED", desc: true, sortValue: (a) => a.tickets.length, html: (a) => esc(a.tickets.length) },
      { key: "open", label: "OPEN", desc: true, sortValue: (a) => agentStats(a).open, html: (a) => esc(agentStats(a).open) },
      { key: "replies", label: "PUBLIC REPLIES", desc: true, sortValue: (a) => agentStats(a).publicReplies, html: (a) => esc(agentStats(a).publicReplies) },
      { key: "notes", label: "INTERNAL NOTES", desc: true, sortValue: (a) => agentStats(a).notes, html: (a) => esc(agentStats(a).notes) },
      { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (a) => toDate(lastActivity(a.tickets))?.getTime() ?? 0, html: (a) => ago(lastActivity(a.tickets)) },
    ],
  });

// ----- detail pages -----------------------------------------------------------------------

async function detailPage(ctx, { section, label, find, render }) {
  ctx.title(label);
  ctx.view.innerHTML = `<div class="panel"><div class="empty">Loading…</div></div>`;
  await ensureCore();
  if (!ctx.isCurrent()) return;
  const crumbs = [{ label: section, href: `/${section.toLowerCase()}` }];
  if (store.ticketsState === "error" && !store.tickets.length) {
    ctx.view.innerHTML = `${pageHead({ crumbs, title: label })}<div class="panel">${errorState(`Could not load tickets: ${store.ticketsError}`)}</div>`;
    return ctx.view.addEventListener("click", async (e) => {
      if (e.target.closest("[data-retry]")) { await loadCore(); if (ctx.isCurrent()) detailPage(ctx, { section, label, find, render }); }
    });
  }
  const entity = find(ctx.params.key ?? ctx.params.id);
  if (!entity) {
    ctx.view.innerHTML = `${pageHead({ crumbs, title: ctx.params.key ?? ctx.params.id })}<div class="panel"><div class="empty error-state">No ${esc(section.toLowerCase().replace(/s$/, ""))} found with this identifier.<br><a class="text-btn" href="/${section.toLowerCase()}">Back to ${esc(section.toLowerCase())}</a></div></div>`;
    return;
  }
  ctx.title(entity.name);
  ctx.view.innerHTML = render(entity, crumbs);
  delegateRowClicks(ctx);
}

export const customerPage = (ctx) =>
  detailPage(ctx, {
    section: "Customers",
    label: "Customer",
    find: (key) => directory().customers.get(key),
    render: (c, crumbs) => {
      const s = stats(c.tickets);
      const events = store.events.filter((e) => c.tickets.some((t) => t.id === e.ticket_id));
      return `${pageHead({ crumbs, title: c.name, subtitle: c.id ? `Customer ID <code>${esc(c.id)}</code>` : "", actions: `<a class="btn secondary" href="/tickets?customer=${encodeURIComponent(c.key)}">View in tickets list</a>` })}
      ${statCards([["Tickets", s.total, "All time"], ["Open", s.open, "Not yet solved"], ["Resolved / closed", s.resolved, s.avg != null ? `Avg. resolution ${formatDuration(s.avg)}` : "Completed tickets"], ["Requesters", c.requesters.size, "People at this customer"]])}
      ${panel("Requesters", "People at this customer who raised tickets.", `<div class="directory-list">${[...c.requesters.values()].map((r) => `<a class="dir-row" href="${requesterHref(r)}">${personCell(r.name || r.email, r.email)}<span class="muted">${plural(c.tickets.filter((t) => requesterKey(t.requester) === requesterKey(r)).length, "ticket")}</span></a>`).join("") || emptyState("No requesters.")}</div>`)}
      ${panel("Tickets", "", compactTickets(c.tickets.slice().sort((a, b) => (toDate(b.updated_at) || 0) - (toDate(a.updated_at) || 0)), "No tickets for this customer."))}
      ${panel("Recent activity", "Latest events across this customer's tickets.", recentEvents(events))}`;
    },
  });

export const requesterPage = (ctx) =>
  detailPage(ctx, {
    section: "Requesters",
    label: "Requester",
    find: (key) => directory().requesters.get(key),
    render: (r, crumbs) => {
      const s = stats(r.tickets);
      const comments = r.events.filter((e) => e.type === "comment");
      return `${pageHead({ crumbs, title: r.name, subtitle: `${esc(r.email || "No email")}${r.id ? ` · ID <code>${esc(r.id)}</code>` : ""}`, actions: r.email ? `<a class="btn secondary" href="/tickets?q=${encodeURIComponent(r.email)}">View in tickets list</a>` : "" })}
      ${statCards([["Tickets", s.total, "Raised by this person"], ["Open", s.open, "Not yet solved"], ["Resolved / closed", s.resolved, s.avg != null ? `Avg. resolution ${formatDuration(s.avg)}` : "Completed tickets"], ["Comments written", comments.length, "As the requester"]])}
      ${panel("Customer", "", `<div class="directory-list">${[...r.customers.values()].map((c) => `<a class="dir-row" href="${customerHref(c)}">${personCell(c.name, c.id)}</a>`).join("") || emptyState("No customer on these tickets.")}</div>`)}
      ${panel("Tickets", "", compactTickets(r.tickets.slice().sort((a, b) => (toDate(b.updated_at) || 0) - (toDate(a.updated_at) || 0))))}
      ${panel("Recent comments", "Comments this person wrote on their tickets.", recentEvents(comments))}`;
    },
  });

export const agentPage = (ctx) =>
  detailPage(ctx, {
    section: "Agents",
    label: "Agent",
    find: (id) => directory().agents.get(id),
    render: (a, crumbs) => {
      const s = agentStats(a);
      return `${pageHead({ crumbs, title: a.name, subtitle: `Agent ID <code>${esc(a.id)}</code>`, actions: `<a class="btn secondary" href="/tickets?assignee=${encodeURIComponent(a.id)}">View in tickets list</a>` })}
      ${statCards([["Assigned tickets", s.total, `${s.open} open`], ["Public replies", s.publicReplies, "Visible to requesters"], ["Internal notes", s.notes, "Agents only"], ["Status changes", s.transitions, "Made by this agent"]])}
      ${panel("Assigned tickets", "", compactTickets(a.tickets.slice().sort((x, y) => (toDate(y.updated_at) || 0) - (toDate(x.updated_at) || 0)), "No tickets are assigned to this agent."))}
      ${panel("Recent activity", "Comments, notes and status changes made by this agent.", recentEvents(a.events))}`;
    },
  });
