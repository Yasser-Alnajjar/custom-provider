import { resolutionMs } from "./format";
import { RESOLVED_STATUSES, type Ticket } from "./types";
import type { Agent } from "./directory";

const isOpen = (t: Ticket) => !RESOLVED_STATUSES.includes(t.status);

export function ticketStats(tickets: Ticket[]) {
  const durations = tickets.map(resolutionMs).filter((ms): ms is number => ms !== null);
  const open = tickets.filter(isOpen).length;

  return {
    total: tickets.length,
    open,
    resolved: tickets.length - open,
    avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

export function agentStats(a: Agent) {
  return {
    ...ticketStats(a.tickets),
    publicReplies: a.events.filter((e) => e.type === "comment" && e.public !== false).length,
    notes: a.events.filter((e) => e.type === "comment" && e.public === false).length,
    transitions: a.events.filter((e) => e.type === "status_changed").length,
  };
}
