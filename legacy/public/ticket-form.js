// Create / edit ticket dialogs. Both talk to the real API (POST / PATCH /api/tickets).

import { createTicket, patchTicket } from "./api.js";
import {
  STATUSES,
  PRIORITIES,
  CHANNELS,
  esc,
  humanize,
  toast,
  $,
} from "./lib.js";
import { store, directory, loadCore, requesterKey } from "./store.js";

function channelOptions(current) {
  const all = [
    ...new Set(
      [...CHANNELS, ...store.tickets.map((t) => t.channel), current].filter(
        Boolean,
      ),
    ),
  ];
  return all
    .map(
      (c) =>
        `<option value="${esc(c)}"${c === current ? " selected" : ""}>${esc(humanize(c))}</option>`,
    )
    .join("");
}
function select(name, values, selected) {
  return `<select name="${name}">${values
    .map(
      (v) =>
        `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(humanize(v))}</option>`,
    )
    .join("")}</select>`;
}
const parseTags = (text) => [
  ...new Set(
    String(text)
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
];

function openDialog(html, onSubmit) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form class="dialog-form" novalidate>${html}</form>`;
  $("#dialogHost").append(dialog);
  const form = dialog.firstElementChild;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", () => setTimeout(() => dialog.remove()));
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".form-error", form);
    err.textContent = "";
    if (!form.reportValidity()) return;
    const submit = $("[type=submit]", form);
    submit.disabled = true;
    try {
      await onSubmit(new FormData(form), form, close);
    } catch (error) {
      // Keep the dialog open so nothing typed is lost.
      err.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.showModal();
  $("input, textarea", form)?.focus();
  return { form, close };
}

const head = (
  title,
  sub,
) => `<div class="dialog-head"><div><h2>${title}</h2><p>${sub}</p></div>
  <button type="button" class="x-btn" data-close aria-label="Close">×</button></div>`;
const foot = (label) => `<div class="form-error" role="alert"></div>
  <div class="dialog-actions"><button type="button" class="btn secondary" data-close>Cancel</button>
  <button class="btn primary" type="submit">${label}</button></div>`;

export function openCreateTicket({ onCreated } = {}) {
  const { customers, requesters, agents } = directory();
  const { form } = openDialog(
    `${head("Create a ticket", "Add a record to the provider API dataset.")}
    <label>Ticket title<input name="title" required placeholder="Briefly describe the issue"></label>
    <label>Description<textarea name="description" rows="3" placeholder="Additional details…"></textarea></label>
    <div class="form-row"><label>Priority${select("priority", PRIORITIES, "normal")}</label>
      <label>Status${select("status", STATUSES, "open")}</label></div>
    <div class="form-row"><label>Channel<select name="channel">${channelOptions("web")}</select></label>
      <label>Assignee<select name="assignee"><option value="">Unassigned</option>${[
        ...agents.values(),
      ]
        .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
        .join("")}</select></label></div>
    <label>Tags <input name="tags" placeholder="billing, bug (comma separated)"></label>
    <div class="form-row"><label>Requester email<input name="email" type="email" required list="knownRequesters" placeholder="name@company.com" autocomplete="off"></label>
      <label>Requester name<input name="requesterName" required placeholder="Full name"></label></div>
    <datalist id="knownRequesters">${[...requesters.values()]
      .map(
        (r) => `<option value="${esc(r.email || "")}">${esc(r.name)}</option>`,
      )
      .join("")}</datalist>
    <label>Customer<select name="customer"><option value="">Automatic (requester's customer, else server default)</option>${[
      ...customers.values(),
    ]
      .map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`)
      .join("")}</select></label>
    ${foot("Create ticket")}`,
    async (f, formEl, close) => {
      const email = String(f.get("email")).trim();
      const known = requesters.get(requesterKey({ email }));
      const knownTicket = known?.tickets[0];
      const chosenCustomer = customers.get(f.get("customer"));
      const customer = chosenCustomer
        ? { id: chosenCustomer.id, name: chosenCustomer.name }
        : knownTicket?.customer;
      const agent = agents.get(f.get("assignee"));
      const body = {
        title: String(f.get("title")).trim(),
        description: String(f.get("description")).trim(),
        status: f.get("status"),
        priority: f.get("priority"),
        channel: f.get("channel"),
        tags: parseTags(f.get("tags")),
        // Returning requesters keep their stored identity.
        requester: knownTicket
          ? { ...knownTicket.requester }
          : { name: String(f.get("requesterName")).trim(), email },
        ...(customer ? { customer } : {}),
        ...(agent ? { assignee: { id: agent.id, name: agent.name } } : {}),
      };
      const created = await createTicket(body);
      close();
      toast(`${created.id} created`);
      await loadCore();
      onCreated?.(created);
    },
  );
  // Returning requesters: fill in their name from the directory.
  form.elements.email.addEventListener("change", (e) => {
    const known = requesters.get(
      requesterKey({ email: e.target.value.trim() }),
    );
    if (known?.name) form.elements.requesterName.value = known.name;
  });
}

export function openEditTicket(ticket, { onSaved } = {}) {
  const { customers } = directory();
  const currentKey = ticket.customer?.id || ticket.customer?.name || "";
  openDialog(
    `${head(`Edit ${esc(ticket.id)}`, "Changes are saved to the provider API.")}
    <label>Ticket title<input name="title" required value="${esc(ticket.title)}"></label>
    <label>Description<textarea name="description" rows="4">${esc(ticket.description || "")}</textarea></label>
    <div class="form-row"><label>Channel<select name="channel">${channelOptions(ticket.channel)}</select></label>
      <label>Customer<select name="customer">${[...customers.values()]
        .map(
          (c) =>
            `<option value="${esc(c.key)}"${c.key === currentKey ? " selected" : ""}>${esc(c.name)}</option>`,
        )
        .join("")}</select></label></div>
    <label>Tags <input name="tags" value="${esc((ticket.tags || []).join(", "))}" placeholder="comma separated"></label>
    <div class="form-row"><label>Requester name<input name="requesterName" required value="${esc(ticket.requester?.name || "")}"></label>
      <label>Requester email<input name="email" type="email" required value="${esc(ticket.requester?.email || "")}"></label></div>
    ${foot("Save changes")}`,
    async (f, formEl, close) => {
      const patch = {};
      const set = (key, value, before) => {
        if (JSON.stringify(value) !== JSON.stringify(before))
          patch[key] = value;
      };
      set("title", String(f.get("title")).trim(), ticket.title);
      set(
        "description",
        String(f.get("description")).trim(),
        ticket.description || "",
      );
      set("channel", f.get("channel"), ticket.channel);
      set("tags", parseTags(f.get("tags")), ticket.tags || []);
      const requester = {
        ...ticket.requester,
        name: String(f.get("requesterName")).trim(),
        email: String(f.get("email")).trim(),
      };
      set("requester", requester, ticket.requester);
      const c = customers.get(f.get("customer"));
      if (c && c.key !== currentKey)
        patch.customer = { id: c.id, name: c.name };
      if (!Object.keys(patch).length) {
        close();
        return toast("No changes to save");
      }
      const saved = await patchTicket(ticket.id, patch);
      close();
      toast(`${ticket.id} updated`);
      await loadCore();
      onSaved?.(saved);
    },
  );
}
