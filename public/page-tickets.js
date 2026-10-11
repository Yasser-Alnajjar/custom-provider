import { patchTicket } from "./api.js";
import {
  $, esc, humanize, plural, timeHtml, toDate, formatDuration, resolutionMs, relativeTime,
  displayName, initials, statusBadge, priorityBadge, pageHead, emptyState, errorState, pager,
  sortHeader, nextSort, compare, readQuery, writeQuery, toast, STATUSES, PRIORITIES, CYCLE_STATUSES, href,
} from "./lib.js";
import { store, ensureCore, loadCore, directory, customerKey, requesterHref, customerHref } from "./store.js";
import { navigate } from "./router.js";
import { openCreateTicket } from "./ticket-form.js";

const DEFAULTS = {
  q: "", status: "", priority: "", assignee: "", customer: "", channel: "", tag: "",
  sort: "updated_at:desc", page: 1, size: 25,
};
const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
const SORTERS = {
  id: (t) => t.id,
  title: (t) => t.title?.toLowerCase(),
  requester: (t) => displayName(t.requester).toLowerCase(),
  customer: (t) => t.customer?.name?.toLowerCase(),
  status: (t) => STATUSES.indexOf(t.status),
  priority: (t) => PRIORITY_RANK[t.priority] ?? -1,
  created_at: (t) => toDate(t.created_at)?.getTime(),
  updated_at: (t) => toDate(t.updated_at)?.getTime() ?? 0,
};

export function filterTickets(tickets, f) {
  const q = f.q.toLowerCase().trim();
  return tickets.filter(
    (t) =>
      (!f.status || f.status.split(",").includes(t.status)) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.channel || t.channel === f.channel) &&
      (!f.tag || (t.tags || []).includes(f.tag)) &&
      (!f.customer || customerKey(t.customer) === f.customer) &&
      (!f.assignee || (f.assignee === "none" ? !t.assignee : t.assignee?.id === f.assignee)) &&
      (!q ||
        [t.id, t.title, t.description, t.requester?.name, t.requester?.email, t.customer?.name,
          t.assignee?.name, t.channel, ...(t.tags || [])]
          .filter(Boolean).join(" ").toLowerCase().includes(q)),
  );
}

function ticketRow(t, customerCounts) {
  const requesterName = displayName(t.requester);
  const ck = customerKey(t.customer);
  const resolution = resolutionMs(t);
  const timeNote =
    resolution !== null
      ? `Resolved in ${formatDuration(resolution)}`
      : toDate(t.created_at) ? `Opened ${relativeTime(t.created_at)}` : "";
  const reqHref = requesterHref(t.requester);
  return `<tr data-href="${href("tickets", t.id)}">
    <td><a class="ticket-id" href="${href("tickets", t.id)}">${esc(t.id)}</a><div class="ticket-title" title="${esc(t.description || "")}">${esc(t.title || "Untitled ticket")}</div>
      <div class="person-sub">${t.assignee ? `Assigned to ${esc(displayName(t.assignee))}` : "Unassigned"}${(t.tags || []).length ? ` · ${(t.tags).map((x) => `#${esc(x)}`).join(" ")}` : ""}</div></td>
    <td>${requesterName
      ? `<div class="person"><div class="mini-avatar">${esc(initials(requesterName))}</div><div><div class="person-name">${reqHref ? `<a href="${reqHref}">${esc(requesterName)}</a>` : esc(requesterName)}</div>${t.requester.name && t.requester.email ? `<div class="person-sub">${esc(t.requester.email)}</div>` : ""}</div></div>`
      : `<span class="person-sub">No requester</span>`}</td>
    <td>${t.customer?.name
      ? `<div class="person-name"><a href="${customerHref(t.customer)}">${esc(t.customer.name)}</a></div><div class="person-sub">${esc(plural(customerCounts.get(ck) || 0, "ticket"))}</div>`
      : `<span class="person-sub">No customer</span>`}</td>
    <td>${statusBadge(t.status)}</td>
    <td>${priorityBadge(t.priority)}</td>
    <td><span class="updated">${timeHtml(t.updated_at)}</span>${timeNote ? `<div class="person-sub">${esc(timeNote)}</div>` : ""}</td>
    <td><button class="row-actions" title="Move to next status" data-cycle="${esc(t.id)}">···</button></td>
  </tr>`;
}

export async function ticketsPage(ctx) {
  ctx.title("Tickets");
  const f = readQuery(DEFAULTS);
  f.page = Math.max(1, Number(f.page) || 1);
  f.size = Number(f.size) || DEFAULTS.size;
  if (!SORTERS[f.sort.split(":")[0]]) f.sort = DEFAULTS.sort;
  const busy = new Set();

  ctx.view.innerHTML = `${pageHead({
    title: "Tickets",
    subtitle: "Every ticket exposed by <code>GET /api/tickets</code>. Open one to see its comments, internal notes and history.",
    actions: `<button class="btn secondary" data-refresh>↻ Refresh data</button><button class="btn primary" data-new>＋ Create ticket</button>`,
  })}
  <section class="panel">
    <div class="toolbar wrap" id="filters"></div>
    <div id="results"><div class="empty">Loading tickets…</div></div>
  </section>`;

  const results = $("#results", ctx.view);
  const filters = $("#filters", ctx.view);

  function buildFilters() {
    const { agents, customers } = directory();
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const count = (fn) => store.tickets.filter(fn).length;
    const statuses = [...new Set([...STATUSES, ...store.tickets.map((t) => t.status)])];
    const channels = [...new Set(store.tickets.map((t) => t.channel).filter(Boolean))].sort();
    const tags = [...new Set(store.tickets.flatMap((t) => t.tags || []))].sort();
    filters.innerHTML = `
      <div class="search">⌕ <input id="q" value="${esc(f.q)}" placeholder="Search ID, title, requester, customer, tag…"></div>
      <select data-f="status" aria-label="Status"><option value="">All statuses</option>${opt("open,in_progress", `Open + in progress (${count((t) => ["open", "in_progress"].includes(t.status))})`, f.status)}${opt("solved,closed", `Solved + closed (${count((t) => ["solved", "closed"].includes(t.status))})`, f.status)}${statuses.map((s) => opt(s, `${humanize(s)} (${count((t) => t.status === s)})`, f.status)).join("")}</select>
      <select data-f="priority" aria-label="Priority"><option value="">All priorities</option>${PRIORITIES.map((p) => opt(p, humanize(p), f.priority)).join("")}</select>
      <select data-f="assignee" aria-label="Assignee"><option value="">Any assignee</option>${opt("none", "Unassigned", f.assignee)}${[...agents.values()].filter((a) => a.tickets.length || a.id === f.assignee).map((a) => opt(a.id, a.name, f.assignee)).join("")}</select>
      <select data-f="customer" aria-label="Customer"><option value="">All customers</option>${[...customers.values()].map((c) => opt(c.key, c.name, f.customer)).join("")}</select>
      <select data-f="channel" aria-label="Channel"><option value="">All channels</option>${channels.map((c) => opt(c, humanize(c), f.channel)).join("")}</select>
      <select data-f="tag" aria-label="Tag"><option value="">All tags</option>${tags.map((t) => opt(t, `#${t}`, f.tag)).join("")}</select>
      <span class="record-count" id="recordCount"></span>`;
    $("#q", filters).addEventListener("input", (e) => {
      f.q = e.target.value;
      f.page = 1;
      draw();
    });
  }

  function draw() {
    writeQuery(f, DEFAULTS);
    const counter = $("#recordCount", filters);
    if (store.ticketsState === "loading") {
      results.innerHTML = emptyState("Loading tickets…");
      return;
    }
    if (store.ticketsState === "error" && !store.tickets.length) {
      results.innerHTML = errorState(`Could not load tickets: ${store.ticketsError}`);
      if (counter) counter.textContent = "—";
      return;
    }
    const [field, dir] = f.sort.split(":");
    const filtered = filterTickets(store.tickets, f).sort(
      (a, b) => compare(SORTERS[field](a), SORTERS[field](b)) * (dir === "desc" ? -1 : 1) || compare(a.id, b.id),
    );
    const total = store.tickets.length;
    counter.textContent = filtered.length === total ? plural(total, "record") : `${filtered.length} of ${plural(total, "record")}`;
    const pages = Math.max(1, Math.ceil(filtered.length / f.size));
    f.page = Math.min(f.page, pages);
    const rows = filtered.slice((f.page - 1) * f.size, f.page * f.size);
    const customerCounts = new Map();
    for (const t of store.tickets) {
      const k = customerKey(t.customer);
      if (k) customerCounts.set(k, (customerCounts.get(k) || 0) + 1);
    }
    const body = rows.length
      ? rows.map((t) => ticketRow(t, customerCounts)).join("")
      : `<tr><td colspan="7" class="empty">${
          total
            ? `No tickets match your filters.<br><button class="text-btn" data-clear>Clear filters</button>`
            : `No tickets yet. Create the first one to get started.`
        }</td></tr>`;
    results.innerHTML = `${store.ticketsState === "error" ? `<div class="notice warn">Showing the last loaded data — refreshing failed: ${esc(store.ticketsError)}</div>` : ""}
      <div class="table-wrap"><table><thead><tr>
        ${sortHeader("TICKET", "id", f.sort)}${sortHeader("REQUESTER", "requester", f.sort)}${sortHeader("CUSTOMER", "customer", f.sort)}
        ${sortHeader("STATUS", "status", f.sort)}${sortHeader("PRIORITY", "priority", f.sort)}${sortHeader("UPDATED", "updated_at", f.sort)}<th></th>
      </tr></thead><tbody>${body}</tbody></table></div>
      ${filtered.length ? pager({ total: filtered.length, page: f.page, size: f.size }) : ""}
      <div class="table-footer"><span>Demo data is stored in memory and resets when the server restarts.</span><span>REST API · JSON</span></div>`;
  }

  async function refresh() {
    await loadCore();
    if (!ctx.isCurrent()) return;
    buildFilters();
    draw();
  }

  ctx.view.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-new]")) return openCreateTicket({ onCreated: (c) => navigate(href("tickets", c.id)) });
    if (t.closest("[data-refresh]")) return refresh().then(() => toast("Data refreshed"));
    if (t.closest("[data-retry]")) return refresh();
    if (t.closest("[data-clear]")) {
      Object.assign(f, { ...DEFAULTS, sort: f.sort, size: f.size });
      buildFilters();
      return draw();
    }
    const sortBtn = t.closest("[data-sort]");
    if (sortBtn) {
      f.sort = nextSort(f.sort, sortBtn.dataset.sort, ["updated_at", "created_at", "priority"].includes(sortBtn.dataset.sort) ? "desc" : "asc");
      return draw();
    }
    const pageBtn = t.closest("[data-page]");
    if (pageBtn && !pageBtn.disabled) {
      f.page = Number(pageBtn.dataset.page);
      draw();
      return window.scrollTo({ top: 0 });
    }
    const cycle = t.closest("[data-cycle]");
    if (cycle) {
      const ticket = store.tickets.find((x) => x.id === cycle.dataset.cycle);
      if (!ticket || busy.has(ticket.id)) return;
      const next = CYCLE_STATUSES[(CYCLE_STATUSES.indexOf(ticket.status) + 1) % CYCLE_STATUSES.length];
      busy.add(ticket.id);
      cycle.disabled = true;
      try {
        // The server sets resolved_at and records the transition in the history.
        await patchTicket(ticket.id, { status: next });
        toast(`${ticket.id} moved to ${humanize(next).toLowerCase()}`);
      } catch (err) {
        toast(err.message, "error");
      } finally {
        busy.delete(ticket.id);
        await refresh();
      }
      return;
    }
    const link = t.closest("a, button, select, input");
    const row = t.closest("tr[data-href]");
    if (row && !link) navigate(row.dataset.href);
  });
  ctx.view.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-f]");
    if (sel) {
      f[sel.dataset.f] = sel.value;
      f.page = 1;
      draw();
    }
    if (e.target.matches("[data-page-size]")) {
      f.size = Number(e.target.value);
      f.page = 1;
      draw();
    }
  });

  await ensureCore();
  if (!ctx.isCurrent()) return;
  buildFilters();
  draw();
}
