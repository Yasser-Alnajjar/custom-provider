"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getEvents, listAllTickets, listPeople, onApiEvent } from "@/lib/client/api";
import { useToken } from "@/lib/client/storage";
import { buildDirectory, type Directory } from "@/lib/directory";
import { time } from "@/lib/format";
import type { PeopleRegistry, Person, Ticket, TicketEvent } from "@/lib/types";

type LoadState = "loading" | "ready" | "error";

interface DeskData {
  tickets: Ticket[];
  events: TicketEvent[];
  ticketsState: LoadState;
  eventsState: LoadState;
  ticketsError: string;
  eventsError: string;
  directory: Directory;
  online: boolean;
  unauthorized: boolean;
  ticketById: (id: string) => Ticket | undefined;
  /** Refetches the list-level data (all tickets and all events). */
  reload: () => Promise<void>;
}

const DeskContext = createContext<DeskData | null>(null);

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

const byRecency = (a: Ticket, b: Ticket) =>
  time(b.updated_at) - time(a.updated_at) ||
  b.id.localeCompare(a.id, undefined, { numeric: true });

/**
 * One shared copy of the list-level data. Customers, requesters and agents are
 * derived from it because the API has no endpoints for them.
 */
export function DeskDataProvider({ children }: { children: React.ReactNode }) {
  const token = useToken();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [registry, setRegistry] = useState<Partial<PeopleRegistry>>({});
  const [ticketsState, setTicketsState] = useState<LoadState>("loading");
  const [eventsState, setEventsState] = useState<LoadState>("loading");
  const [ticketsError, setTicketsError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const [online, setOnline] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);

  useEffect(
    () =>
      onApiEvent((e) => {
        if (e === "unauthorized") setUnauthorized(true);
        else setOnline(e === "online");
      }),
    [],
  );

  const reload = useCallback(() => {
    if (inflight.current) return inflight.current;

    const run = Promise.all([
      listAllTickets().then(
        (list) => {
          setTickets(list.sort(byRecency));
          setTicketsState("ready");
          setTicketsError("");
          setUnauthorized(false);
        },
        (e) => {
          setTicketsState("error");
          setTicketsError(message(e));
        },
      ),
      getEvents().then(
        (list) => {
          setEvents(list);
          setEventsState("ready");
          setEventsError("");
        },
        (e) => {
          setEventsState("error");
          setEventsError(message(e));
        },
      ),
      // People without tickets only exist in these lists; a failure just hides them.
      Promise.all((["customers", "requesters", "agents"] as const).map(listPeople)).then(
        ([customers, requesters, agents]) => {
          const person = (r: (typeof customers)[number]): Person => ({ id: r.id, name: r.name, email: r.email });

          setRegistry({ customers: customers.map(person), requesters: requesters.map(person), agents: agents.map(person) });
        },
        () => {},
      ),
    ]).then(() => {
      inflight.current = null;
    });

    inflight.current = run;
    return run;
  }, []);

  // Load on mount and whenever the API token changes.
  useEffect(() => {
    void reload();
  }, [reload, token]);

  const directory = useMemo(() => buildDirectory(tickets, events, registry), [tickets, events, registry]);
  const index = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);

  const value = useMemo<DeskData>(
    () => ({
      tickets,
      events,
      ticketsState,
      eventsState,
      ticketsError,
      eventsError,
      directory,
      online,
      unauthorized,
      ticketById: (id) => index.get(id),
      reload,
    }),
    [tickets, events, ticketsState, eventsState, ticketsError, eventsError, directory, online, unauthorized, index, reload],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskData {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used inside DeskDataProvider");
  return ctx;
}
