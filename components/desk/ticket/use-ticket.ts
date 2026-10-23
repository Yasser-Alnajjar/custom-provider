"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getComments, getEvents, getHistory, getTicket } from "@/lib/client/api";
import type { Ticket, TicketEvent } from "@/lib/types";

interface TicketData {
  ticket: Ticket | null;
  comments: TicketEvent[] | null;
  history: TicketEvent[] | null;
  events: TicketEvent[] | null;
  /** Per-section errors; a section keeps its earlier data when a refresh fails. */
  errors: Partial<Record<"comments" | "history" | "events", string>>;
  /** Set when the ticket itself could not be loaded. */
  fatal: ApiError | Error | null;
  loading: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loads one ticket with its comments, history and events. Sections fail independently. */
export function useTicket(id: string) {
  const [data, setData] = useState<TicketData>({
    ticket: null, comments: null, history: null, events: null, errors: {}, fatal: null, loading: true,
  });
  const live = useRef(true);

  const load = useCallback(async () => {
    const [t, c, h, e] = await Promise.allSettled([getTicket(id), getComments(id), getHistory(id), getEvents({ ticket_id: id })]);

    if (!live.current) return { ok: false as const, error: t.status === "rejected" ? message(t.reason) : "" };

    if (t.status === "rejected") {
      setData((d) => ({ ...d, loading: false, fatal: d.ticket ? null : t.reason }));
      return { ok: false as const, error: message(t.reason) };
    }

    setData((d) => {
      const errors: TicketData["errors"] = {};
      const pick = <K extends "comments" | "history" | "events">(key: K, r: PromiseSettledResult<TicketEvent[]>) => {
        if (r.status === "fulfilled") return r.value;
        errors[key] = message(r.reason);
        return d[key];
      };

      return {
        ticket: t.value,
        comments: pick("comments", c),
        history: pick("history", h),
        events: pick("events", e),
        errors,
        fatal: null,
        loading: false,
      };
    });
    return { ok: true as const };
  }, [id]);

  useEffect(() => {
    live.current = true;
    // Fetching on mount (and when the id changes) is the effect's job; state is set when the requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  return { ...data, load };
}
