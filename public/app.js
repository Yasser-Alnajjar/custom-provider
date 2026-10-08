const TOKEN = "demo_elapsed_token";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};
const $ = (s) => document.querySelector(s);
let allTickets = [];
let allEvents = [];
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
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "??"
  );
}
function prettyDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
async function loadTickets() {
  try {
    const data = await api("/api/tickets?page=1&limit=100");
    allTickets = data.data.items;
    renderTickets();
    $("#totalStat").textContent = allTickets.length;
    $("#openStat").textContent = allTickets.filter(
      (t) => t.status === "open" || t.status === "in_progress",
    ).length;
    $("#pendingStat").textContent = allTickets.filter(
      (t) => t.status === "pending",
    ).length;
    $("#resolvedStat").textContent = allTickets.filter((t) =>
      ["solved", "closed"].includes(t.status),
    ).length;
    $("#navCount").textContent = allTickets.length;
  } catch (e) {
    toast(`Could not load tickets: ${e.message}`);
  }
}
function renderTickets() {
  const q = $("#searchInput").value.toLowerCase().trim(),
    status = $("#statusFilter").value;
  const filtered = allTickets.filter(
    (t) =>
      (!status || t.status === status) &&
      `${t.id} ${t.title} ${t.description} ${t.requester?.name}`
        .toLowerCase()
        .includes(q),
  );
  $("#recordCount").textContent =
    `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;
  $("#ticketRows").innerHTML = filtered.length
    ? filtered
        .map(
          (t) => `<tr>
    <td><div class="ticket-id">${esc(t.id)}</div><div class="ticket-title">${esc(t.title)}</div></td>
    <td><div class="person"><div class="mini-avatar">${esc(initials(t.requester?.name))}</div><div><div class="person-name">${esc(t.requester?.name || "Unknown")}</div><div class="person-sub">${esc(t.requester?.email || "No email")}</div></div></div></td>
    <td><div class="person-name">${esc(t.customer?.name || "—")}</div><div class="person-sub">${esc(t.customer?.id || "")}</div></td>
    <td><span class="status s-${esc(t.status)}">${esc(t.status.replace("_", " "))}</span></td>
    <td><span class="priority p-${esc(t.priority)}">● &nbsp;${esc(t.priority)}</span></td>
    <td><span class="updated">${esc(prettyDate(t.updated_at))}</span></td>
    <td><button class="row-actions" title="Cycle ticket status" data-cycle="${esc(t.id)}">···</button></td>
  </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">No tickets match your filters.</td></tr>`;
  document
    .querySelectorAll("[data-cycle]")
    .forEach((btn) =>
      btn.addEventListener("click", () => cycleStatus(btn.dataset.cycle)),
    );
}
async function cycleStatus(id) {
  const t = allTickets.find((x) => x.id === id);
  if (!t) return;
  const states = ["open", "in_progress", "pending", "solved", "closed"],
    next = states[(states.indexOf(t.status) + 1) % states.length];
  try {
    await api(`/api/tickets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: next,
        ...(next === "solved" || next === "closed"
          ? { resolved_at: new Date().toISOString() }
          : { resolved_at: null }),
      }),
    });
    await refreshAll();
    toast(`${id} moved to ${next.replace("_", " ")}`);
  } catch (e) {
    toast(e.message);
  }
}
async function loadEvents() {
  try {
    const data = await api("/api/events");
    allEvents = data.data.items;
    $("#eventList").innerHTML =
      allEvents
        .slice()
        .reverse()
        .slice(0, 8)
        .map(
          (e) =>
            `<div class="event"><div class="event-mark">${e.type === "created" ? "＋" : e.type === "comment" ? "☰" : "↻"}</div><div class="event-body"><div class="event-title"><b>${esc(e.type.replace("_", " "))}</b> · ${esc(e.ticket_id)}</div><div class="event-meta">${esc(e.author?.name || "System")} · ${esc(prettyDate(e.created_at))}</div><div class="event-note">${esc(e.body || "")}</div></div></div>`,
        )
        .join("") || `<div class="empty">No events available.</div>`;
  } catch (e) {
    toast(`Could not load events: ${e.message}`);
  }
}
async function refreshAll() {
  await loadTickets();
  await loadEvents();
}
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
$("#ticketForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.currentTarget;
  const f = new FormData(form);

  const body = {
    title: f.get("title"),
    description: f.get("description"),
    status: f.get("status"),
    priority: f.get("priority"),
    requester: {
      id: `usr-${Date.now()}`,
      name: f.get("requesterName"),
      email: f.get("email"),
    },
    customer: {
      id: "org-demo",
      name: "Demo Customer",
    },
  };

  try {
    await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify(body),
    });

    // Close the dialog immediately after successful creation
    dialog.close();

    // Reset the form after successful creation
    form.reset();

    // Refresh tickets/events
    await refreshAll();

    toast("Ticket created and exposed through the API.");
  } catch (err) {
    // Keep dialog open when creation fails
    toast(err.message);
  }
});
$("#baseUrl").textContent = `${location.origin}/api`;
refreshAll();
