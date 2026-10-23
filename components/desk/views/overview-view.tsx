"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDuration, humanize, plural, resolutionMs, time, href } from "@/lib/format";
import { OPEN_STATUSES, RESOLVED_STATUSES, STATUSES } from "@/lib/types";
import { STATUS_BAR } from "../badges";
import { useDesk } from "../data-provider";
import { EventItem } from "../event-item";
import { PageHeader } from "../page-header";
import { Empty, ErrorState, Panel, StatGrid } from "../panel";
import { CreateTicketDialog } from "../ticket-dialogs";
import { CompactTickets } from "../tickets-table";

export function OverviewView() {
  const desk = useDesk();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { tickets, events, directory } = desk;

  const header = (
    <PageHeader
      title="Acme Desk"
      badge={
        <span className="ml-[7px] rounded-full border border-[#1e4967] bg-[#102a40] px-2 py-[5px] align-middle text-micro font-medium tracking-normal whitespace-nowrap text-[#7ed6ff]">
          Demo provider
        </span>
      }
      subtitle="A lightweight ticketing system for validating Elapsed's Custom Provider integration."
      actions={
        <>
          <Button variant="outline" onClick={() => desk.reload().then(() => toast("Data refreshed"))}>↻ Refresh data</Button>
          <Button onClick={() => setCreating(true)}>＋ Create ticket</Button>
        </>
      }
    />
  );

  const dialog = creating && (
    <CreateTicketDialog open onOpenChange={setCreating} onCreated={(t) => router.push(href("tickets", t.id))} />
  );

  if (desk.ticketsState === "loading") {
    return <>{header}<Panel><Empty>Loading…</Empty></Panel>{dialog}</>;
  }

  if (desk.ticketsState === "error" && !tickets.length) {
    return <>{header}<Panel><ErrorState message={`Could not load tickets: ${desk.ticketsError}`} onRetry={desk.reload} /></Panel>{dialog}</>;
  }

  const count = (statuses: readonly string[]) => tickets.filter((t) => statuses.includes(t.status)).length;
  const urgent = tickets.filter((t) => OPEN_STATUSES.includes(t.status) && ["urgent", "high"].includes(t.priority)).length;
  const customers = directory.customers.size;
  const durations = tickets.map(resolutionMs).filter((ms): ms is number => ms !== null);
  const statuses = [...new Set<string>([...STATUSES, ...tickets.map((t) => t.status)])];
  const max = Math.max(1, ...statuses.map((s) => count([s])));
  const latest = [...events].sort((a, b) => time(b.created_at) - time(a.created_at)).slice(0, 8);

  return (
    <>
      {header}
      <StatGrid
        items={[
          { label: "Total tickets", tone: "blue", value: tickets.length, note: customers ? `Across ${plural(customers, "customer")}` : "Available through REST API", href: "/tickets" },
          { label: "Open tickets", tone: "blue", value: count(OPEN_STATUSES), note: urgent ? `${urgent} high or urgent priority` : "Require attention", href: "/tickets?status=open,in_progress" },
          { label: "Pending tickets", tone: "amber", value: count(["pending"]), note: "Waiting for response", href: "/tickets?status=pending" },
          { label: "Resolved / closed", tone: "green", value: count(RESOLVED_STATUSES), note: durations.length ? `Avg. resolution ${formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length)}` : "Completed tickets", href: "/tickets?status=solved,closed" },
        ]}
      />
      <div className="grid grid-cols-[1.6fr_1fr] gap-4 max-lg:grid-cols-1">
        <Panel
          title="Recently updated"
          description="The latest tickets by update time."
          action={<Link href="/tickets" className="link text-small">All tickets →</Link>}
        >
          <CompactTickets tickets={tickets.slice(0, 6)} empty="No tickets yet." />
        </Panel>
        <Panel title="By status" description="Click a status to filter the list.">
          <div className="grid gap-1 px-[18px] pb-4">
            {statuses.map((s) => (
              <Link key={s} href={`/tickets?status=${s}`} className="grid grid-cols-[90px_1fr_28px] items-center gap-2.5 py-[7px] text-small text-[#b9c5d8] hover:text-white">
                <span>{humanize(s)}</span>
                <span className="h-2 overflow-hidden rounded bg-[#0b1220]">
                  <span className={`block h-full rounded ${STATUS_BAR[s] ?? "bg-[#3a465c]"}`} style={{ width: `${(count([s]) / max) * 100}%` }} />
                </span>
                <span className="text-right text-[#8a98ae]">{count([s])}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title="Latest activity"
        description="Latest events across tickets."
        action={<Link href="/activity" className="link text-small">All activity →</Link>}
      >
        {desk.eventsState === "error" && !events.length ? (
          <ErrorState message={`Could not load activity: ${desk.eventsError}`} onRetry={desk.reload} />
        ) : (
          <div className="px-[18px] pb-3">
            {latest.length ? latest.map((e) => <EventItem key={e.id} event={e} ticket={desk.ticketById(e.ticket_id)} />) : <Empty>No activity yet.</Empty>}
          </div>
        )}
      </Panel>
      {dialog}
    </>
  );
}
