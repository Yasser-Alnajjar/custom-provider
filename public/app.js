const TOKEN = "demo_elapsed_token";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};
const $ = (s) => document.querySelector(s);
function esc(v = "") {
  return String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function initials(name = "") {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "?"
  );
}

const KNOWN_STATUSES = ["open", "in_progress", "pending", "solved", "closed"];
const RESOLVED_STATUSES = ["solved", "closed"];
const OPEN_STATUSES = ["open", "in_progress"];
const state = {
  tickets: [],
  events: [],
  ticketsState: "loading",
  eventsState: "loading",
  ticketsError: "",
  eventsError: "",
  busy: new Set(),
};

function humanize(value) {
  const text = String(value ?? "")
    .replace(/_/g, " ")
    .trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function absoluteDate(value) {
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
function relativeTime(value) {
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
function formatDuration(ms) {
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
function resolutionMs(t) {
  if (!RESOLVED_STATUSES.includes(t.status)) return null;
  const created = toDate(t.created_at),
    resolved = toDate(t.resolved_at);
  if (!created || !resolved || resolved < created) return null;
  return resolved - created;
}
function displayName(person) {
  return person?.name || person?.email || "";
}
function timeHtml(value) {
  const text = humanize(relativeTime(value));
  const title = absoluteDate(value);
  return `<time datetime="${esc(value || "")}" title="${esc(title)}">${esc(text)}</time>`;
}
function setApiStatus(online) {
  const el = $("#apiStatus");
  el.classList.toggle("offline", !online);
  el.lastElementChild.textContent = online ? "API online" : "API unreachable";
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Could not reach the server");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  if (!data) throw new Error("Unexpected response from the server");
  return data;
}

// Follow pagination until the server reports there are no more pages.
async function fetchAllTickets() {
  const items = [];
  let page = 1;
  for (let guard = 0; page && guard < 100; guard++) {
    const { data } = await api(`/api/tickets?page=${page}&limit=100`);
    items.push(...(data?.items || []));
    page = data?.pagination?.next_page || null;
  }
  return items;
}
async function loadTickets() {
  if (!state.tickets.length) state.ticketsState = "loading";
  renderTickets();
  try {
    state.tickets = (await fetchAllTickets()).sort(
      (a, b) =>
        (toDate(b.updated_at) || 0) - (toDate(a.updated_at) || 0) ||
        String(b.id).localeCompare(String(a.id)),
    );
    state.ticketsState = "ready";
    setApiStatus(true);
  } catch (e) {
    state.ticketsState = "error";
    state.ticketsError = e.message;
    setApiStatus(false);
  }
  renderStats();
  renderStatusOptions();
  renderTickets();
  renderEvents();
}

function renderStats() {
  const ready = state.ticketsState === "ready" || state.tickets.length > 0;
  const list = state.tickets;
  const count = (statuses) =>
    list.filter((t) => statuses.includes(t.status)).length;
  const set = (id, value) => ($(id).textContent = ready ? value : "—");
  set("#totalStat", list.length);
  set("#openStat", count(OPEN_STATUSES));
  set("#pendingStat", count(["pending"]));
  set("#resolvedStat", count(RESOLVED_STATUSES));
  if (!ready) return;

  const urgent = list.filter(
    (t) =>
      OPEN_STATUSES.includes(t.status) &&
      ["urgent", "high"].includes(t.priority),
  ).length;
  $("#openNote").textContent = urgent
    ? `${urgent} high or urgent priority`
    : "Require attention";
  const customers = new Set(
    list.map((t) => t.customer?.id || t.customer?.name).filter(Boolean),
  ).size;
  $("#totalNote").textContent = customers
    ? `Across ${plural(customers, "customer")}`
    : "Available through REST API";
  const durations = list.map(resolutionMs).filter((ms) => ms !== null);
  $("#resolvedNote").textContent = durations.length
    ? `Avg. resolution ${formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length)}`
    : "Completed tickets";
}

function renderStatusOptions() {
  const select = $("#statusFilter"),
    current = select.value;
  const present = new Set(state.tickets.map((t) => t.status).filter(Boolean));
  const statuses = [
    ...KNOWN_STATUSES,
    ...[...present].filter((s) => !KNOWN_STATUSES.includes(s)),
  ];
  select.innerHTML =
    `<option value="">All statuses</option>` +
    statuses
      .map((s) => {
        const n = state.tickets.filter((t) => t.status === s).length;
        return `<option value="${esc(s)}">${esc(humanize(s))} (${n})</option>`;
      })
      .join("");
  select.value = statuses.includes(current) ? current : "";
}

function ticketRow(t, customerCounts) {
  const requesterName = displayName(t.requester);
  const customerKey = t.customer?.id || t.customer?.name;
  const customerTickets = customerCounts.get(customerKey) || 0;
  const resolution = resolutionMs(t);
  const created = toDate(t.created_at);
  const timeNote = resolution !== null
      ? `Resolved in ${formatDuration(resolution)}`
      : created
        ? `Opened ${relativeTime(t.created_at)}`
        : "";
  return `<tr>
    <td><div class="ticket-id">${esc(t.id)}</div><div class="ticket-title" title="${esc(t.description || "")}">${esc(t.title || "Untitled ticket")}</div><div class="person-sub">${t.assignee ? `Assigned to ${esc(displayName(t.assignee))}` : "Unassigned"}</div></td>
    <td>${
      requesterName
        ? `<div class="person"><div class="mini-avatar">${esc(initials(requesterName))}</div><div><div class="person-name">${esc(requesterName)}</div>${t.requester.name && t.requester.email ? `<div class="person-sub">${esc(t.requester.email)}</div>` : ""}</div></div>`
        : `<span class="person-sub">No requester</span>`
    }</td>
    <td>${
      t.customer?.name
        ? `<div class="person-name">${esc(t.customer.name)}</div><div class="person-sub">${esc(plural(customerTickets, "ticket"))}</div>`
        : `<span class="person-sub">No customer</span>`
    }</td>
    <td>${t.status ? `<span class="status s-${esc(t.status)}">${esc(humanize(t.status))}</span>` : `<span class="person-sub">—</span>`}</td>
    <td>${t.priority ? `<span class="priority p-${esc(t.priority)}">● &nbsp;${esc(t.priority)}</span>` : `<span class="person-sub">—</span>`}</td>
    <td><span class="updated">${timeHtml(t.updated_at)}</span>${timeNote ? `<div class="person-sub">${esc(timeNote)}</div>` : ""}</td>
    <td><button class="row-actions" title="Move to next status" data-cycle="${esc(t.id)}"${state.busy.has(t.id) ? " disabled" : ""}>···</button></td>
  </tr>`;
}
function messageRow(html) {
  return `<tr><td colspan="7" class="empty">${html}</td></tr>`;
}
function renderTickets() {
  const q = $("#searchInput").value.toLowerCase().trim(),
    status = $("#statusFilter").value;
  const rows = $("#ticketRows"),
    counter = $("#recordCount");

  if (state.ticketsState === "loading") {
    counter.textContent = "Loading…";
    rows.innerHTML = messageRow("Loading tickets…");
    return;
  }
  if (state.ticketsState === "error" && !state.tickets.length) {
    counter.textContent = "—";
    rows.innerHTML = messageRow(
      `Could not load tickets: ${esc(state.ticketsError)}<br><button class="text-btn" data-retry>Try again</button>`,
    );
    return;
  }

  const filtered = state.tickets.filter(
    (t) =>
      (!status || t.status === status) &&
      [
        t.id,
        t.title,
        t.description,
        t.requester?.name,
        t.requester?.email,
        t.customer?.name,
        t.assignee?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const total = state.tickets.length;
  counter.textContent =
    filtered.length === total
      ? plural(total, "record")
      : `${filtered.length} of ${plural(total, "record")}`;

  if (filtered.length) {
    const customerCounts = new Map();
    for (const t of state.tickets) {
      const key = t.customer?.id || t.customer?.name;
      if (key) customerCounts.set(key, (customerCounts.get(key) || 0) + 1);
    }
    rows.innerHTML = filtered.map((t) => ticketRow(t, customerCounts)).join("");
  } else if (!total) {
    rows.innerHTML = messageRow("No tickets yet. Create the first one to get started.");
  } else {
    rows.innerHTML = messageRow(
      `No tickets match your filters.<br><button class="text-btn" data-clear>Clear filters</button>`,
    );
  }
}
$("#ticketRows").addEventListener("click", (e) => {
  const cycle = e.target.closest("[data-cycle]");
  if (cycle) return cycleStatus(cycle.dataset.cycle);
  if (e.target.closest("[data-retry]")) return refreshAll();
  if (e.target.closest("[data-clear]")) {
    $("#searchInput").value = "";
    $("#statusFilter").value = "";
    renderTickets();
  }
});

async function cycleStatus(id) {
  const t = state.tickets.find((x) => x.id === id);
  if (!t || state.busy.has(id)) return;
  const next = KNOWN_STATUSES[(KNOWN_STATUSES.indexOf(t.status) + 1) % KNOWN_STATUSES.length];
  const patch = { status: next };
  // Keep the original resolution time when moving between solved and closed.
  if (!RESOLVED_STATUSES.includes(next)) patch.resolved_at = null;
  else if (!RESOLVED_STATUSES.includes(t.status))
    patch.resolved_at = new Date().toISOString();
  state.busy.add(id);
  renderTickets();
  try {
    await api(`/api/tickets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    // Record the change in the ticket's history, as the server's own events do.
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({
        ticket_id: id,
        type: "status_changed",
        body: `Status changed to ${next.replace(/_/g, " ")}`,
      }),
    }).catch(() => {});
    toast(`${id} moved to ${next.replace(/_/g, " ")}`);
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy.delete(id);
    await refreshAll();
  }
}

function eventIcon(type) {
  return type === "created" ? "＋" : type === "comment" ? "☰" : "↻";
}
function renderEvents() {
  const list = $("#eventList");
  if (state.eventsState === "loading") {
    list.innerHTML = `<div class="empty">Loading activity…</div>`;
    return;
  }
  if (state.eventsState === "error") {
    list.innerHTML = `<div class="empty">Could not load activity: ${esc(state.eventsError)}<br><button class="text-btn" data-retry-events>Try again</button></div>`;
    return;
  }
  const titles = new Map(state.tickets.map((t) => [t.id, t.title]));
  const latest = state.events
    .slice()
    .sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0))
    .slice(0, 8);
  list.innerHTML =
    latest
      .map((e) => {
        const title = titles.get(e.ticket_id);
        return `<div class="event"><div class="event-mark">${eventIcon(e.type)}</div><div class="event-body"><div class="event-title"><b>${esc(humanize(e.type) || "Update")}</b> · ${esc(e.ticket_id)}${title ? ` · ${esc(title)}` : ""}</div><div class="event-meta">${esc(e.author?.name || "System")} · ${timeHtml(e.created_at)}</div>${e.body ? `<div class="event-note">${esc(e.body)}</div>` : ""}</div></div>`;
      })
      .join("") || `<div class="empty">No activity yet.</div>`;
}
$("#eventList").addEventListener("click", (e) => {
  if (e.target.closest("[data-retry-events]")) loadEvents();
});
async function loadEvents() {
  if (!state.events.length) state.eventsState = "loading";
  renderEvents();
  try {
    const { data } = await api("/api/events");
    state.events = data?.items || [];
    state.eventsState = "ready";
  } catch (e) {
    state.eventsState = "error";
    state.eventsError = e.message;
  }
  renderEvents();
}
async function refreshAll() {
  await Promise.all([loadTickets(), loadEvents()]);
}
// Keep relative timestamps fresh without refetching.
setInterval(() => {
  if (state.ticketsState === "ready") renderTickets();
  if (state.eventsState === "ready") renderEvents();
}, 60000);
$("#searchInput").addEventListener("input", renderTickets);
$("#statusFilter").addEventListener("change", renderTickets);
$("#refreshBtn").addEventListener("click", () =>
  refreshAll().then(() => toast("Data refreshed")),
);
$("#eventsRefresh").addEventListener("click", loadEvents);
document.querySelectorAll(".copy").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const value =
      btn.dataset.value ||
      (btn.dataset.copy ? $("#" + btn.dataset.copy).textContent : "");
    try {
      await navigator.clipboard.writeText(value);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    } catch {
      toast(value);
    }
  }),
);
const dialog = $("#ticketDialog");
$("#newTicketBtn").addEventListener("click", () => dialog.showModal());
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#cancelDialog").addEventListener("click", () => dialog.close());
function findRequester(email) {
  const key = email.trim().toLowerCase();
  if (!key) return null;
  return (
    state.tickets.find((t) => t.requester?.email?.toLowerCase() === key) ||
    null
  );
}
// Returning requesters keep their name, identity and customer.
$("#ticketForm").elements.email.addEventListener("change", (e) => {
  const known = findRequester(e.target.value)?.requester;
  const name = $("#ticketForm").elements.requesterName;
  if (known?.name) name.value = known.name;
});
$("#ticketForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.currentTarget;
  const f = new FormData(form);
  const email = String(f.get("email")).trim();
  const match = findRequester(email);

  const body = {
    title: String(f.get("title")).trim(),
    description: String(f.get("description")).trim(),
    status: f.get("status"),
    priority: f.get("priority"),
    requester: match
      ? { ...match.requester }
      : { name: String(f.get("requesterName")).trim(), email },
    // Without a known customer the server applies its own default.
    ...(match?.customer ? { customer: match.customer } : {}),
  };

  try {
    await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify(body),
    });
    dialog.close();
    form.reset();
    await refreshAll();
    toast("Ticket created.");
  } catch (err) {
    // Keep dialog open when creation fails
    toast(err.message);
  }
});
$("#baseUrl").textContent = `${location.origin}/api`;
refreshAll();
