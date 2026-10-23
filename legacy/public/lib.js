// Small, dependency-free helpers shared by every page.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function esc(v = "") {
  return String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Enumerations documented by the server (validation errors list the same values).
export const STATUSES = ["new", "open", "pending", "in_progress", "solved", "closed"];
export const RESOLVED_STATUSES = ["solved", "closed"];
export const OPEN_STATUSES = ["open", "in_progress"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const CHANNELS = ["email", "chat", "web"];
// Statuses the "next status" row action cycles through ("new" is a starting state only).
export const CYCLE_STATUSES = ["open", "in_progress", "pending", "solved", "closed"];

export function initials(name = "") {
  return (
    String(name)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "?"
  );
}
export function humanize(value) {
  const text = String(value ?? "").replace(/_/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function absoluteDate(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "short",
});
export function relativeTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  // A timestamp well ahead of this device's clock is clock skew; show it as-is.
  if (seconds < -300)
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return relativeFormat.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeFormat.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return relativeFormat.format(-days, "day");
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
// Only trust resolved_at when the ticket is actually resolved and the dates make sense.
export function resolutionMs(t) {
  if (!RESOLVED_STATUSES.includes(t.status)) return null;
  const created = toDate(t.created_at),
    resolved = toDate(t.resolved_at);
  if (!created || !resolved || resolved < created) return null;
  return resolved - created;
}
export function displayName(person) {
  return person?.name || person?.email || "";
}
export function timeHtml(value) {
  const text = humanize(relativeTime(value));
  return `<time datetime="${esc(value || "")}" title="${esc(absoluteDate(value))}">${esc(text)}</time>`;
}
// Keeps relative timestamps fresh without re-rendering a page.
export function refreshTimes(root = document) {
  for (const el of $$("time[datetime]", root)) {
    if (el.getAttribute("datetime"))
      el.textContent = humanize(relativeTime(el.getAttribute("datetime")));
  }
}

export const href = (...parts) =>
  "/" + parts.map((p) => encodeURIComponent(String(p))).join("/");

export function statusBadge(status) {
  return status
    ? `<span class="status s-${esc(status)}">${esc(humanize(status))}</span>`
    : `<span class="person-sub">—</span>`;
}
export function priorityBadge(priority) {
  return priority
    ? `<span class="priority p-${esc(priority)}">● &nbsp;${esc(priority)}</span>`
    : `<span class="person-sub">—</span>`;
}
export function roleBadge(role) {
  return role ? `<span class="role r-${esc(role)}">${esc(humanize(role))}</span>` : "";
}
export function avatar(name, cls = "mini-avatar") {
  return `<div class="${cls}">${esc(initials(name))}</div>`;
}

export function toast(message, kind = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", kind === "error");
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), kind === "error" ? 4500 : 2500);
}
export async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    if (button) {
      const label = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = label), 1200);
    } else toast("Copied to clipboard");
  } catch {
    toast(value);
  }
}

// ----- shared page building blocks -------------------------------------------

export function pageHead({ crumbs = [], title, badge = "", subtitle = "", actions = "" }) {
  const trail = [
    ...crumbs.map((c) => (c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : esc(c.label))),
    `<b>${esc(title)}</b>`,
  ].join(" <span>/</span> ");
  return `<header>
    <div>
      <div class="breadcrumbs">${trail}</div>
      <h1>${esc(title)}${badge}</h1>
      ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
    </div>
    ${actions ? `<div class="header-actions">${actions}</div>` : ""}
  </header>`;
}
export function emptyState(html) {
  return `<div class="empty">${html}</div>`;
}
export function errorState(message, retryAttr = "data-retry") {
  return `<div class="empty error-state">${esc(message)}<br><button class="text-btn" ${retryAttr}>Try again</button></div>`;
}

export function pager({ total, page, size, sizes = [10, 25, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  const nums = [];
  for (let p = 1; p <= pages; p++)
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  return `<div class="pager">
    <span>${total ? `Showing ${from}–${to} of ${total}` : "No results"}</span>
    <div class="pager-controls">
      <label class="pager-size">Rows <select data-page-size>${sizes
        .map((n) => `<option value="${n}"${n === size ? " selected" : ""}>${n}</option>`)
        .join("")}</select></label>
      <button class="page-btn" data-page="${page - 1}"${page <= 1 ? " disabled" : ""}>‹ Prev</button>
      ${nums
        .map((n) =>
          n === "…"
            ? `<span class="page-gap">…</span>`
            : `<button class="page-btn${n === page ? " current" : ""}" data-page="${n}">${n}</button>`,
        )
        .join("")}
      <button class="page-btn" data-page="${page + 1}"${page >= pages ? " disabled" : ""}>Next ›</button>
    </div>
  </div>`;
}

export function sortHeader(label, key, sort) {
  const [field, dir] = sort.split(":");
  const active = field === key;
  return `<th><button class="sort${active ? " active" : ""}" data-sort="${key}">${label}<i>${active ? (dir === "asc" ? "▲" : "▼") : ""}</i></button></th>`;
}
export function nextSort(sort, key, defaultDir = "asc") {
  const [field, dir] = sort.split(":");
  return field === key ? `${key}:${dir === "asc" ? "desc" : "asc"}` : `${key}:${defaultDir}`;
}
export function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function eventLabel(e) {
  if (e.type === "created") return "Ticket created";
  if (e.type === "status_changed") return "Status changed";
  if (e.type === "comment") return e.public === false ? "Internal note" : "Public comment";
  return humanize(e.type) || "Update";
}
export function eventIcon(e) {
  if (e.type === "created") return "＋";
  if (e.type === "status_changed") return "↻";
  return e.public === false ? "🔒︎" : "☰";
}
export function transitionHtml(from, to) {
  return `${statusBadge(from)} <span class="arrow">→</span> ${statusBadge(to)}`;
}
// One activity entry. Comments get a visibility badge, status changes show the transition.
export function eventItem(e, { ticket, showTicket = true } = {}) {
  const who = e.author?.name || "System";
  const title = ticket?.title;
  const ticketRef = showTicket
    ? ` · <a href="${href("tickets", e.ticket_id)}">${esc(e.ticket_id)}</a>${title ? ` · ${esc(title)}` : ""}`
    : "";
  const detail =
    e.type === "status_changed"
      ? `<div class="event-note">${transitionHtml(e.from, e.to)}</div>`
      : e.body && e.type !== "created"
        ? `<div class="event-note">${esc(e.body)}</div>`
        : "";
  const internal = e.type === "comment" && e.public === false;
  return `<div class="event${internal ? " internal" : ""}">
    <div class="event-mark">${eventIcon(e)}</div>
    <div class="event-body">
      <div class="event-title"><b>${esc(eventLabel(e))}</b>${ticketRef}</div>
      <div class="event-meta">${esc(who)} ${roleBadge(e.author?.role)} · ${timeHtml(e.created_at)}</div>
      ${detail}
    </div>
  </div>`;
}

// URL <-> state helpers for filterable lists.
export function readQuery(defaults) {
  const q = new URLSearchParams(location.search);
  const out = {};
  for (const [k, d] of Object.entries(defaults)) out[k] = q.get(k) ?? d;
  return out;
}
export function writeQuery(state, defaults) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state))
    if (v !== "" && v != null && String(v) !== String(defaults[k])) q.set(k, v);
  const qs = q.toString();
  history.replaceState(history.state, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
}
