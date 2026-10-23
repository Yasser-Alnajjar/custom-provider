// Ticket details: overview, conversation (public replies vs internal notes),
// activity log + status history, people, dates, related tickets and actions.

import {
  getTicket, getComments, getHistory, getEvents, patchTicket, addComment, getActor,
} from "./api.js";
import {
  $, esc, humanize, plural, timeHtml, absoluteDate, toDate, formatDuration, resolutionMs,
  displayName, statusBadge, priorityBadge, roleBadge, avatar, pageHead, emptyState,
  eventItem, transitionHtml, toast, copyText, STATUSES, PRIORITIES, href,
} from "./lib.js";
import {
  store, ensureCore, loadCore, directory, customerHref, requesterHref, requesterKey, agentHref,
} from "./store.js";
import { navigate } from "./router.js";
import { openEditTicket } from "./ticket-form.js";

const section = (title, body, extra = "") =>
  `<section class="panel"><div class="panel-heading"><div><h2>${title}</h2></div>${extra}</div>${body}</section>`;

function firstResponseMs(ticket, comments) {
  const created = toDate(ticket.created_at);
  const reply = comments.find((c) => c.author?.role === "agent" && c.public !== false);
  const at = toDate(reply?.created_at);
  return created && at && at >= created ? at - created : null;
}

export async function ticketPage(ctx) {
  const id = ctx.params.id;
  ctx.title(id);
  const s = {
    ticket: null,
    comments: null,
    history: null,
    events: null,
    errors: {},
    convFilter: "all",
    activityTab: "all",
    composeMode: "public",
    draft: "",
    busy: false,
  };

  ctx.view.innerHTML = `<div id="ticketRoot"><div class="panel"><div class="empty">Loading ${esc(id)}…</div></div></div>`;
  const root = $("#ticketRoot", ctx.view);

  // ----- data ------------------------------------------------------------------
  async function load({ initial = false } = {}) {
    const [t, c, h, e] = await Promise.allSettled([
      getTicket(id), getComments(id), getHistory(id), getEvents({ ticket_id: id }),
    ]);
    if (!ctx.isCurrent()) return;
    if (t.status === "rejected") {
      if (initial) return renderTicketError(t.reason);
      return toast(t.reason.message, "error");
    }
    s.ticket = t.value;
    for (const [key, r] of [["comments", c], ["history", h], ["events", e]]) {
      if (r.status === "fulfilled") {
        s[key] = r.value;
        delete s.errors[key];
      } else s.errors[key] = r.reason.message;
    }
    ctx.title(`${s.ticket.id} · ${s.ticket.title}`);
    if (initial) renderPage();
    else renderAll();
  }
  // After a mutation: refetch this ticket's data and refresh the shared lists in the background.
  async function reloadAfterMutation() {
    await load();
    loadCore();
  }

  function renderTicketError(err) {
    const missing = err.status === 404;
    root.innerHTML = `${pageHead({ crumbs: [{ label: "Tickets", href: "/tickets" }], title: id })}
      <div class="panel"><div class="empty error-state">${
        missing ? `Ticket <b>${esc(id)}</b> does not exist on the server.` : `Could not load the ticket: ${esc(err.message)}`
      }<br>${missing ? `<a class="text-btn" href="/tickets">Back to tickets</a>` : `<button class="text-btn" data-retry>Try again</button>`}</div></div>`;
  }

  // ----- layout ------------------------------------------------------------------
  function renderPage() {
    const t = s.ticket;
    root.innerHTML = `${pageHead({
      crumbs: [{ label: "Tickets", href: "/tickets" }],
      title: t.id,
      subtitle: "",
      actions: `<button class="btn secondary" data-reload>↻ Refresh</button><button class="btn primary" data-edit>✎ Edit ticket</button>`,
    })}
    <div class="detail-grid">
      <div class="detail-main">
        <div id="overview"></div>
        <div id="conversation"></div>
        <div id="composer"></div>
        <div id="activity"></div>
      </div>
      <aside class="detail-side">
        <div id="properties"></div>
        <div id="people"></div>
        <div id="dates"></div>
        <div id="related"></div>
        <div id="unsupported"></div>
      </aside>
    </div>`;
    renderAll();
  }
  function renderAll() {
    renderOverview();
    renderConversation();
    renderComposer();
    renderActivity();
    renderSide();
  }

  // ----- overview -----------------------------------------------------------------
  function renderOverview() {
    const t = s.ticket;
    $("#overview", root).innerHTML = `<section class="panel overview">
      <div class="overview-top">
        <div>
          <div class="overview-badges">${statusBadge(t.status)} ${priorityBadge(t.priority)}
            ${t.channel ? `<span class="chip">via ${esc(t.channel)}</span>` : ""}</div>
          <h2 class="overview-title">${esc(t.title)}</h2>
        </div>
        <div class="overview-id"><code>${esc(t.id)}</code><button class="copy" data-copy="${esc(t.id)}">Copy</button></div>
      </div>
      <div class="overview-desc">${t.description ? esc(t.description).replace(/\n/g, "<br>") : `<span class="muted">No description.</span>`}</div>
      <div class="chips">${(t.tags || []).length
        ? t.tags.map((x) => `<a class="chip tag" href="/tickets?tag=${encodeURIComponent(x)}">#${esc(x)}</a>`).join("")
        : `<span class="muted">No tags</span>`}</div>
    </section>`;
  }

  // ----- conversation ----------------------------------------------------------------
  function commentHtml(c) {
    const internal = c.public === false;
    const role = c.author?.role;
    return `<article class="comment ${internal ? "internal" : "public"} by-${esc(role || "unknown")}" id="${esc(c.id)}">
      ${avatar(c.author?.name || "System", "mini-avatar lg")}
      <div class="comment-body">
        <div class="comment-head">
          <b>${esc(c.author?.name || "Unknown")}</b> ${roleBadge(role)}
          ${internal
            ? `<span class="vis internal" title="Only visible to agents">🔒︎ Internal note</span>`
            : `<span class="vis public" title="Visible to the requester">Public</span>`}
          <span class="comment-time">${timeHtml(c.created_at)}</span>
        </div>
        <div class="comment-text">${esc(c.body).replace(/\n/g, "<br>")}</div>
      </div>
    </article>`;
  }
  function renderConversation() {
    const el = $("#conversation", root);
    if (s.errors.comments && !s.comments) {
      el.innerHTML = section("Conversation", `<div class="empty error-state">Could not load comments: ${esc(s.errors.comments)}<br><button class="text-btn" data-retry-section>Try again</button></div>`);
      return;
    }
    const all = s.comments || [];
    const internal = all.filter((c) => c.public === false);
    const pub = all.length - internal.length;
    const shown = s.convFilter === "internal" ? internal : s.convFilter === "public" ? all.filter((c) => c.public !== false) : all;
    const seg = (key, label, n) =>
      `<button class="seg${s.convFilter === key ? " active" : ""}" data-conv="${key}">${label} <i>${n}</i></button>`;
    el.innerHTML = section(
      "Conversation",
      `${s.errors.comments ? `<div class="notice warn">Showing earlier data — refresh failed: ${esc(s.errors.comments)}</div>` : ""}
       <div class="comments">${
        shown.length
          ? shown.map(commentHtml).join("")
          : emptyState(all.length ? `No ${s.convFilter === "internal" ? "internal notes" : "public comments"} on this ticket.` : "No comments yet. Add the first reply below.")
      }</div>`,
      `<div class="segmented">${seg("all", "All", all.length)}${seg("public", "Public replies", pub)}${seg("internal", "Internal notes", internal.length)}</div>`,
    );
  }

  // ----- composer -----------------------------------------------------------------------
  function authorOptions() {
    const t = s.ticket;
    const actor = getActor();
    const opts = [{ label: `${actor.name} (you, agent)`, author: actor }];
    if (t.assignee?.id && t.assignee.id !== actor.id)
      opts.push({ label: `${t.assignee.name} (assignee)`, author: { id: t.assignee.id, name: t.assignee.name, role: "agent" } });
    if (s.composeMode === "public" && t.requester)
      opts.push({
        label: `${displayName(t.requester)} (requester, simulate customer reply)`,
        author: { id: t.requester.id, name: displayName(t.requester), role: "customer" },
      });
    return opts;
  }
  function renderComposer() {
    const el = $("#composer", root);
    if (!s.ticket) return;
    const prev = $("#composeBody", el);
    if (prev) s.draft = prev.value;
    const prevAuthor = $("#composeAuthor", el)?.value;
    const opts = authorOptions();
    const internal = s.composeMode === "internal";
    el.innerHTML = `<section class="panel composer ${internal ? "internal" : ""}">
      <div class="composer-tabs">
        <button class="seg${!internal ? " active" : ""}" data-mode="public">Public reply</button>
        <button class="seg${internal ? " active" : ""}" data-mode="internal">🔒︎ Internal note</button>
        <span class="composer-hint">${internal ? "Only agents can see internal notes. Elapsed treats them as non-public." : "Visible to the requester."}</span>
      </div>
      <form id="composeForm">
        <textarea id="composeBody" rows="4" placeholder="${internal ? "Write an internal note…" : "Write a reply…"}" aria-label="Comment text">${esc(s.draft)}</textarea>
        <div class="composer-foot">
          <label>Post as <select id="composeAuthor">${opts.map((o, i) => `<option value="${i}"${String(i) === prevAuthor ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
          <button class="btn primary" type="submit"${s.busy ? " disabled" : ""}>${internal ? "Add note" : "Send reply"}</button>
        </div>
        <div class="form-error" id="composeError" role="alert"></div>
      </form>
    </section>`;
  }
  async function submitComment(form) {
    const body = $("#composeBody", form).value.trim();
    const err = $("#composeError", form);
    err.textContent = "";
    if (!body) return (err.textContent = "Write something first.");
    const author = authorOptions()[Number($("#composeAuthor", form).value)]?.author;
    s.busy = true;
    $("[type=submit]", form).disabled = true;
    try {
      await addComment({
        ticket_id: s.ticket.id,
        body,
        author,
        isPublic: s.composeMode !== "internal",
      });
      s.draft = "";
      toast(s.composeMode === "internal" ? "Internal note added" : "Reply sent");
      s.busy = false;
      await reloadAfterMutation();
      $("#conversation .comment:last-of-type", root)?.scrollIntoView({ block: "nearest" });
    } catch (e) {
      s.busy = false;
      err.textContent = e.message;
      $("[type=submit]", form).disabled = false;
    }
  }

  // ----- activity + history -----------------------------------------------------------------
  function timeInStatus(history) {
    // How long the ticket spent in each status, from consecutive real transitions.
    const created = toDate(s.ticket.created_at);
    const spans = [];
    let from = created, status = history[0]?.from || "new";
    for (const h of history) {
      const at = toDate(h.created_at);
      if (from && at) spans.push({ status, ms: at - from });
      status = h.to;
      from = at;
    }
    if (from) spans.push({ status, ms: Date.now() - from, current: true });
    return spans;
  }
  function renderActivity() {
    const el = $("#activity", root);
    const tab = s.activityTab;
    const events = s.events;
    const history = s.history;
    const tabBtn = (key, label, n) =>
      `<button class="seg${tab === key ? " active" : ""}" data-activity="${key}">${label}${n != null ? ` <i>${n}</i>` : ""}</button>`;
    let body;
    const failed = (key) =>
      `<div class="empty error-state">Could not load ${key}: ${esc(s.errors[key])}<br><button class="text-btn" data-retry-section>Try again</button></div>`;
    if (tab === "history") {
      if (!history) body = failed("history");
      else if (!history.length) body = emptyState("No status changes recorded.");
      else {
        const spans = timeInStatus(history);
        body = `<div class="status-path">${spans.map((sp) => `<span class="path-step">${statusBadge(sp.status)}<small>${sp.current ? "now · " : ""}${esc(formatDuration(sp.ms))}</small></span>`).join('<span class="arrow">→</span>')}</div>
          <div class="event-list">${history.map((h) => `<div class="event"><div class="event-mark">↻</div><div class="event-body">
            <div class="event-title"><b>Status changed</b> · ${transitionHtml(h.from, h.to)}</div>
            <div class="event-meta">${esc(h.author?.name || "System")} ${roleBadge(h.author?.role)} · ${timeHtml(h.created_at)}</div></div></div>`).reverse().join("")}</div>`;
      }
    } else {
      if (!events) body = failed("events");
      else {
        const list = events.filter((e) => tab === "all" || e.type === tab).slice().reverse();
        body = list.length
          ? `<div class="event-list">${list.map((e) => eventItem(e, { showTicket: false })).join("")}</div>`
          : emptyState("No activity of this type.");
      }
    }
    const count = (type) => events?.filter((e) => e.type === type).length;
    el.innerHTML = section(
      "Activity & history",
      body,
      `<div class="segmented">${tabBtn("all", "All activity", events?.length ?? 0)}${tabBtn("status_changed", "Status changes", count("status_changed") ?? 0)}${tabBtn("comment", "Comments", count("comment") ?? 0)}${tabBtn("history", "Status history", history?.length ?? 0)}</div>`,
    );
  }

  // ----- sidebar -----------------------------------------------------------------------
  function agentOptions() {
    const { agents } = directory();
    const list = new Map([...agents.values()].map((a) => [a.id, a.name]));
    const actor = getActor();
    if (actor.id) list.set(actor.id, actor.name);
    if (s.ticket.assignee?.id) list.set(s.ticket.assignee.id, s.ticket.assignee.name);
    return list;
  }
  function renderSide() {
    const t = s.ticket;
    const dir = directory();
    const opts = (values, cur) =>
      values.map((v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(humanize(v))}</option>`).join("");
    const statuses = [...new Set([...STATUSES, t.status])];
    $("#properties", root).innerHTML = section("Properties", `<div class="props">
      <label>Status<select data-prop="status">${opts(statuses, t.status)}</select></label>
      <label>Priority<select data-prop="priority">${opts(PRIORITIES, t.priority)}</select></label>
      <label>Assignee<select data-prop="assignee"><option value="">Unassigned</option>${[...agentOptions()].map(([aid, name]) => `<option value="${esc(aid)}"${aid === t.assignee?.id ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>
      <div class="prop-note">Status changes are written to the history; priority and assignee changes are saved but the server does not log them as events.</div>
    </div>`);

    const reqHref = requesterHref(t.requester);
    const cusHref = customerHref(t.customer);
    const asgHref = agentHref(t.assignee);
    $("#people", root).innerHTML = section("People", `<div class="people">
      <div class="person-row"><span class="label">Requester</span>${t.requester
        ? `<div class="person">${avatar(displayName(t.requester))}<div><div class="person-name">${reqHref ? `<a href="${reqHref}">${esc(displayName(t.requester))}</a>` : esc(displayName(t.requester))}</div>
           <div class="person-sub">${esc(t.requester.email || "")}${t.requester.id ? ` · ${esc(t.requester.id)}` : ""}</div></div></div>`
        : `<span class="muted">None</span>`}</div>
      <div class="person-row"><span class="label">Customer</span>${t.customer
        ? `<div class="person">${avatar(t.customer.name || "")}<div><div class="person-name">${cusHref ? `<a href="${cusHref}">${esc(t.customer.name || t.customer.id)}</a>` : esc(t.customer.name)}</div><div class="person-sub">${esc(t.customer.id || "")}</div></div></div>`
        : `<span class="muted">None</span>`}</div>
      <div class="person-row"><span class="label">Assignee</span>${t.assignee
        ? `<div class="person">${avatar(t.assignee.name)}<div><div class="person-name">${asgHref ? `<a href="${asgHref}">${esc(t.assignee.name)}</a>` : esc(t.assignee.name)}</div><div class="person-sub">${esc(t.assignee.id || "")}</div></div></div>`
        : `<span class="muted">Unassigned</span>`}</div>
    </div>`);

    const resolution = resolutionMs(t);
    const first = s.comments ? firstResponseMs(t, s.comments) : null;
    const dl = (k, v) => `<div class="kv"><dt>${k}</dt><dd>${v}</dd></div>`;
    const abs = (v) => (v ? `${timeHtml(v)}<div class="person-sub">${esc(absoluteDate(v))}</div>` : `<span class="muted">—</span>`);
    $("#dates", root).innerHTML = section("Timeline", `<dl class="kvs">
      ${dl("Created", abs(t.created_at))}
      ${dl("Last updated", abs(t.updated_at))}
      ${dl("Resolved", t.resolved_at ? abs(t.resolved_at) : `<span class="muted">Not resolved</span>`)}
      ${dl("Time to first reply", first != null ? esc(formatDuration(first)) : `<span class="muted">${s.comments ? "No agent reply yet" : "—"}</span>`)}
      ${dl("Time to resolution", resolution != null ? esc(formatDuration(resolution)) : `<span class="muted">—</span>`)}
      ${dl("Comments", s.comments ? `${s.comments.filter((c) => c.public !== false).length} public · ${s.comments.filter((c) => c.public === false).length} internal` : "—")}
      ${dl("External URL", t.url ? `<code class="wrap">${esc(t.url)}</code> <button class="copy" data-copy="${esc(t.url)}">Copy</button>` : `<span class="muted">—</span>`)}
    </dl>`);

    const others = store.tickets.filter((x) => x.id !== t.id);
    const sameReq = t.requester ? others.filter((x) => requesterKey(x.requester) === requesterKey(t.requester)) : [];
    const sameCus = t.customer ? others.filter((x) => x.customer?.id === t.customer.id && !sameReq.includes(x)) : [];
    const rel = (list) => list.slice(0, 5).map((x) => `<a class="related" href="${href("tickets", x.id)}"><span class="ticket-id">${esc(x.id)}</span><span class="related-title">${esc(x.title)}</span>${statusBadge(x.status)}</a>`).join("");
    $("#related", root).innerHTML = section("Related tickets", store.ticketsState === "ready"
      ? `<div class="related-list">
          ${sameReq.length ? `<div class="label">Same requester (${sameReq.length})</div>${rel(sameReq)}` : ""}
          ${sameCus.length ? `<div class="label">Same customer (${sameCus.length})</div>${rel(sameCus)}${sameCus.length > 5 ? `<a class="text-btn" href="${cusHref}">View all ${sameCus.length} →</a>` : ""}` : ""}
          ${!sameReq.length && !sameCus.length ? `<span class="muted">No other tickets from this requester or customer.</span>` : ""}
        </div>`
      : `<div class="empty">Related tickets unavailable${store.ticketsError ? `: ${esc(store.ticketsError)}` : ""}</div>`);

    $("#unsupported", root).innerHTML = `<div class="notice subtle"><b>Not provided by this API</b><br>Attachments, custom fields, ticket type, groups and linked/merged records are not part of the server's ticket model, so they are not shown.</div>`;
  }

  // ----- events ---------------------------------------------------------------------------------
  async function mutate(patch, message) {
    s.busy = true;
    try {
      await patchTicket(s.ticket.id, patch);
      toast(message);
    } catch (e) {
      toast(e.message, "error");
    }
    s.busy = false;
    await reloadAfterMutation();
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-retry]")) return load({ initial: true });
    if (t.closest("[data-retry-section]") || t.closest("[data-reload]"))
      return load().then(() => t.closest("[data-reload]") && toast("Ticket refreshed"));
    if (t.closest("[data-edit]") && s.ticket) return openEditTicket(s.ticket, { onSaved: () => load() });
    const copy = t.closest("[data-copy]");
    if (copy) return copyText(copy.dataset.copy, copy);
    const conv = t.closest("[data-conv]");
    if (conv) { s.convFilter = conv.dataset.conv; return renderConversation(); }
    const mode = t.closest("[data-mode]");
    if (mode) { s.composeMode = mode.dataset.mode; return renderComposer(); }
    const act = t.closest("[data-activity]");
    if (act) { s.activityTab = act.dataset.activity; return renderActivity(); }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "composeForm") {
      e.preventDefault();
      submitComment(e.target);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "composeBody" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $("#composeForm", root).requestSubmit();
    }
  });
  root.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-prop]");
    if (!sel || s.busy) return;
    const prop = sel.dataset.prop;
    if (prop === "status") return mutate({ status: sel.value }, `Status changed to ${humanize(sel.value).toLowerCase()}`);
    if (prop === "priority") return mutate({ priority: sel.value }, `Priority set to ${sel.value}`);
    if (prop === "assignee") {
      const name = agentOptions().get(sel.value);
      return mutate({ assignee: sel.value ? { id: sel.value, name } : null }, sel.value ? `Assigned to ${name}` : "Ticket unassigned");
    }
  });

  await Promise.all([load({ initial: true }), ensureCore()]);
  if (ctx.isCurrent() && s.ticket) renderSide();
}
