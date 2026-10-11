import {
  $, esc, humanize, plural, formatDuration, resolutionMs, pageHead, errorState, eventItem, emptyState,
  toast, STATUSES, OPEN_STATUSES, RESOLVED_STATUSES, toDate,
} from "./lib.js";
import { store, ensureCore, loadCore, ticketById, directory } from "./store.js";
import { compactTickets } from "./page-directory.js";
import { openCreateTicket } from "./ticket-form.js";
import { navigate } from "./router.js";

export async function overviewPage(ctx) {
  ctx.title("");
  ctx.view.innerHTML = `${pageHead({
    title: "Acme Desk",
    badge: ` <span class="pill"><i></i> Demo provider</span>`,
    subtitle: "A lightweight ticketing system for validating Elapsed's Custom Provider integration.",
    actions: `<button class="btn secondary" data-refresh>↻ Refresh data</button><button class="btn primary" data-new>＋ Create ticket</button>`,
  })}<div id="body"><div class="panel"><div class="empty">Loading…</div></div></div>`;
  const body = $("#body", ctx.view);

  function draw() {
    if (store.ticketsState === "error" && !store.tickets.length) {
      body.innerHTML = `<div class="panel">${errorState(`Could not load tickets: ${store.ticketsError}`)}</div>`;
      return;
    }
    const list = store.tickets;
    const count = (statuses) => list.filter((t) => statuses.includes(t.status)).length;
    const urgent = list.filter((t) => OPEN_STATUSES.includes(t.status) && ["urgent", "high"].includes(t.priority)).length;
    const customers = directory().customers.size;
    const durations = list.map(resolutionMs).filter((ms) => ms !== null);
    const stat = (label, dot, value, note, to) =>
      `<a class="stat" href="${to}"><div class="stat-top">${label} <span class="${dot}">●</span></div><strong>${value}</strong><small>${esc(note)}</small></a>`;
    const statuses = [...new Set([...STATUSES, ...list.map((t) => t.status)])];
    const max = Math.max(1, ...statuses.map((s) => count([s])));
    const recent = list.slice(0, 6);
    const latest = store.events.slice().sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0)).slice(0, 8);
    const titles = new Map(list.map((t) => [t.id, t]));
    body.innerHTML = `<section class="stats">
      ${stat("Total tickets", "blue", list.length, customers ? `Across ${plural(customers, "customer")}` : "Available through REST API", "/tickets")}
      ${stat("Open tickets", "blue", count(OPEN_STATUSES), urgent ? `${urgent} high or urgent priority` : "Require attention", "/tickets?status=open,in_progress")}
      ${stat("Pending tickets", "amber", count(["pending"]), "Waiting for response", "/tickets?status=pending")}
      ${stat("Resolved / closed", "green", count(RESOLVED_STATUSES), durations.length ? `Avg. resolution ${formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length)}` : "Completed tickets", "/tickets?status=solved,closed")}
    </section>
    <section class="two-col">
      <div class="panel"><div class="panel-heading"><div><h2>Recently updated</h2><p>The latest tickets by update time.</p></div><a class="text-btn" href="/tickets">All tickets →</a></div>
        ${compactTickets(recent, "No tickets yet.")}</div>
      <div class="panel"><div class="panel-heading"><div><h2>By status</h2><p>Click a status to filter the list.</p></div></div>
        <div class="bars">${statuses.map((s) => `<a class="bar-row" href="/tickets?status=${s}"><span class="bar-label">${esc(humanize(s))}</span><span class="bar-track"><span class="bar-fill s-${esc(s)}" style="width:${(count([s]) / max) * 100}%"></span></span><span class="bar-n">${count([s])}</span></a>`).join("")}</div>
      </div>
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Latest activity</h2><p>Latest events across tickets.</p></div><a class="text-btn" href="/activity">All activity →</a></div>
      ${store.eventsState === "error" && !store.events.length
        ? errorState(`Could not load activity: ${store.eventsError}`)
        : `<div class="event-list padded">${latest.map((e) => eventItem(e, { ticket: titles.get(e.ticket_id) })).join("") || emptyState("No activity yet.")}</div>`}
    </section>`;
  }

  ctx.view.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-new]")) return openCreateTicket({ onCreated: (c) => navigate(`/tickets/${encodeURIComponent(c.id)}`) });
    if (t.closest("[data-refresh]") || t.closest("[data-retry]")) {
      await loadCore();
      if (ctx.isCurrent()) draw();
      return t.closest("[data-refresh]") && toast("Data refreshed");
    }
    const row = t.closest("tr[data-href]");
    if (row && !t.closest("a, button")) navigate(row.dataset.href);
  });
  await ensureCore();
  if (ctx.isCurrent()) draw();
}
