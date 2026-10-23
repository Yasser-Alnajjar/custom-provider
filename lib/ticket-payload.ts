import { requesterKey, type Directory } from "./directory";
import type { Person, Ticket } from "./types";

export const parseTags = (text: string): string[] => [
  ...new Set(
    text
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
];

export interface CreateInput {
  title: string;
  description: string;
  status: string;
  priority: string;
  channel: string;
  tags: string;
  email: string;
  requesterName: string;
  customerKey: string;
  assigneeId: string;
}

/** Builds the POST /api/tickets body. Returning requesters keep their stored identity. */
export function buildCreateBody(input: CreateInput, dir: Directory): Record<string, unknown> {
  const email = input.email.trim();
  const knownTicket = dir.requesters.get(requesterKey({ email }))?.tickets[0];
  const chosen = dir.customers.get(input.customerKey);
  const customer: Person | null | undefined = chosen ? { id: chosen.id, name: chosen.name } : knownTicket?.customer;
  const agent = dir.agents.get(input.assigneeId);

  return {
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    priority: input.priority,
    channel: input.channel,
    tags: parseTags(input.tags),
    requester: knownTicket?.requester ? { ...knownTicket.requester } : { name: input.requesterName.trim(), email },
    ...(customer ? { customer } : {}),
    ...(agent ? { assignee: { id: agent.id, name: agent.name } } : {}),
  };
}

export interface EditInput {
  title: string;
  description: string;
  channel: string;
  tags: string;
  requesterName: string;
  email: string;
  customerKey: string;
}

/** Builds the PATCH body from only the fields that actually changed. */
export function buildPatch(ticket: Ticket, input: EditInput, dir: Directory): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown, before: unknown) => {
    if (JSON.stringify(value) !== JSON.stringify(before)) patch[key] = value;
  };

  set("title", input.title.trim(), ticket.title);
  set("description", input.description.trim(), ticket.description || "");
  set("channel", input.channel, ticket.channel);
  set("tags", parseTags(input.tags), ticket.tags || []);
  set("requester", { ...ticket.requester, name: input.requesterName.trim(), email: input.email.trim() }, ticket.requester);

  const currentKey = ticket.customer?.id || ticket.customer?.name || "";
  const customer = dir.customers.get(input.customerKey);

  if (customer && customer.key !== currentKey) patch.customer = { id: customer.id, name: customer.name };
  return patch;
}
