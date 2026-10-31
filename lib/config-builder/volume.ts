import { paginationType } from "./contract";
import type { BuilderState, PaginationState } from "./model";

/** Pages needed to read `items` items with this pagination, or 1 when it cannot be paginated/known. */
export function pagesFor(p: PaginationState, items: number): number {
  const size = Number(p.values.pageSize);

  if (p.type !== "page" || !Number.isFinite(size) || size < 1) return 1;
  return Math.max(1, Math.ceil(items / size));
}

export interface VolumeEstimate {
  listRequests: number;
  commentRequests: number;
  historyRequests: number;
  total: number;
}

/** Rough HTTP request count of one full sync: the ticket list plus the per-ticket child requests. */
export function estimateRequests(s: BuilderState, tickets: number, childItemsPerTicket: number): VolumeEstimate {
  const n = Math.max(0, Math.floor(tickets));
  const child = Math.max(0, Math.floor(childItemsPerTicket));
  const listRequests = pagesFor(s.tickets.pagination, n);
  const commentRequests = s.comments.enabled ? n * pagesFor(s.comments.pagination, child) : 0;
  const historyRequests = s.statusHistory.enabled ? n * pagesFor(s.statusHistory.pagination, child) : 0;

  return { listRequests, commentRequests, historyRequests, total: listRequests + commentRequests + historyRequests };
}

export const paginationLabel = (type: string) => paginationType(type)?.label ?? (type || "Not set");
