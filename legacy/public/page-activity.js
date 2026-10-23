// Activity: every event from GET /api/events across all tickets.

import {
  $, esc, humanize, plural, toDate, pageHead, emptyState, errorState, pager, eventItem,
  readQuery, writeQuery, toast,
} from "./lib.js";
import { store, ensureCore, loadCore, ticketById } from "./store.js";

const DEFAULTS = { q: "", type: "", visibility: "", role: "", order: "desc", page: 1, size: 25 };

export function filterEvents(events, f) {
  const q = f.q.toLowerCase().trim();
  return events.filter(
    (e) =>
      (!f.type || e.type === f.type) &&
      (!f.role || e.author?.role === f.role) &&
      (!f.visibility ||
        (f.visibility === "internal" ? e.public === false : e.public !== false)) &&
      (!q ||
        [e.ticket_id, e.body, e.author?.name, ticketById(e.ticket_id)?.title]
          .filter(Boolean).join(" ").toLowerCase().includes(q)),
  );
}

export async function activityPage(ctx) {
  ctx.title("Activity");
  const f = readQuery(DEFAULTS);
  f.page = Math.max(1, Number(f.page) || 1);
  f.size = Number(f.size) || DEFAULTS.size;

  ctx.view.innerHTML = `${pageHead({
    title: "Activity",
    subtitle: "All events recorded by the provider (<code>GET /api/events</code>): ticket creation, comments, internal notes and status changes.",
    actions: `<button class="btn secondary" data-refresh>↻ Refresh data</button>`,
  })}
  <section class="panel">
    <div class="toolbar wrap" id="filters"></div>
    <div id="results"><div class="empty">Loading activity…</div></div>
  </section>`;
  const results = $("#results", ctx.view);
  const filters = $("#filters", ctx.view);

  function buildFilters() {
    const types = [...new Set(store.events.map((e) => e.type))];
    const roles = [...new Set(store.events.map((e) => e.author?.role).filter(Boolean))];
    const o = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
    filters.innerHTML = `<div class="search">⌕ <input id="q" value="${esc(f.q)}" placeholder="Search ticket ID, text or author…"></div>
      <select data-f="type" aria-label="Event type"><option value="">All event types</option>${types.map((t) => o(t, humanize(t), f.type)).join("")}</select>
      <select data-f="visibility" aria-label="Visibility"><option value="">Public + internal</option>${o("public", "Public only", f.visibility)}${o("internal", "Internal notes only", f.visibility)}</select>
      <select data-f="role" aria-label="Author role"><option value="">Any author</option>${roles.map((r) => o(r, humanize(r), f.role)).join("")}</select>
      <select data-f="order" aria-label="Order">${o("desc", "Newest first", f.order)}${o("asc", "Oldest first", f.order)}</select>
      <span class="record-count" id="recordCount"></span>`;
    $("#q", filters).addEventListener("input", (e) => {
      f.q = e.target.value;
      f.page = 1;
      draw();
    });
  }
  function draw() {
    writeQuery(f, DEFAULTS);
    if (store.eventsState === "error" && !store.events.length) {
      results.innerHTML = errorState(`Could not load activity: ${store.eventsError}`);
      return;
    }
    const sign = f.order === "asc" ? 1 : -1;
    const list = filterEvents(store.events, f).sort(
      (a, b) => sign * ((toDate(a.created_at) || 0) - (toDate(b.created_at) || 0)),
    );
    $("#recordCount", filters).textContent =
      list.length === store.events.length ? plural(list.length, "event") : `${list.length} of ${plural(store.events.length, "event")}`;
    f.page = Math.min(f.page, Math.max(1, Math.ceil(list.length / f.size)));
    const rows = list.slice((f.page - 1) * f.size, f.page * f.size);
    results.innerHTML = `<div class="event-list padded">${
      rows.length
        ? rows.map((e) => eventItem(e, { ticket: ticketById(e.ticket_id) })).join("")
        : emptyState(store.events.length ? `No events match your filters.<br><button class="text-btn" data-clear>Clear filters</button>` : "No activity yet.")
    }</div>${list.length ? pager({ total: list.length, page: f.page, size: f.size }) : ""}`;
  }
  async function refresh() {
    await loadCore();
    if (!ctx.isCurrent()) return;
    buildFilters();
    draw();
  }
  ctx.view.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-refresh]")) return refresh().then(() => toast("Data refreshed"));
    if (t.closest("[data-retry]")) return refresh();
    if (t.closest("[data-clear]")) {
      Object.assign(f, { ...DEFAULTS, size: f.size });
      buildFilters();
      return draw();
    }
    const p = t.closest("[data-page]");
    if (p && !p.disabled) {
      f.page = Number(p.dataset.page);
      draw();
      window.scrollTo({ top: 0 });
    }
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
