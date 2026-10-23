"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client/api";

import { Chip, PriorityBadge, StatusBadge } from "../badges";
import { CopyButton } from "../copy-button";
import { useDesk } from "../data-provider";
import { PageHeader } from "../page-header";
import { Empty, Panel } from "../panel";
import { DeleteTicketDialog, EditTicketDialog } from "../ticket-dialogs";
import { Activity } from "../ticket/activity";
import { Composer } from "../ticket/composer";
import { Conversation } from "../ticket/conversation";
import { People, Properties, Related, Timeline, Unsupported } from "../ticket/side-panels";
import { useTicket } from "../ticket/use-ticket";

export function TicketView({ id }: { id: string }) {
  const desk = useDesk();
  const { ticket, comments, history, events, errors, fatal, loading, load } = useTicket(id);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const crumbs = [{ label: "Tickets", href: "/tickets" }];

  // After a mutation: refetch this ticket's data and refresh the shared lists in the background.
  const afterMutation = async () => {
    await load();
    void desk.reload();
  };

  if (loading) return <Panel><Empty>Loading {id}…</Empty></Panel>;

  if (!ticket) {
    const missing = fatal instanceof ApiError && fatal.status === 404;

    return (
      <>
        <PageHeader crumbs={crumbs} title={id} />
        <Panel>
          <Empty className="text-bad">
            {missing ? <>Ticket <b>{id}</b> does not exist on the server.</> : `Could not load the ticket: ${fatal?.message}`}
            <br />
            {missing ? <Link href="/tickets" className="link">Back to tickets</Link> : <Button variant="link" size="sm" onClick={() => load()}>Try again</Button>}
          </Empty>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={ticket.id}
        actions={
          <>
            <Button variant="outline" onClick={() => load().then((r) => r.ok ? toast("Ticket refreshed") : toast.error(r.error))}>↻ Refresh</Button>
            <Button onClick={() => setEditing(true)}>✎ Edit ticket</Button>
            <Button variant="destructive" onClick={() => setDeleting(true)}>Delete</Button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-lg:grid-cols-1">
        <div className="min-w-0">
          <section className="mb-4 rounded-[10px] border bg-card p-[18px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={ticket.status} /> <PriorityBadge priority={ticket.priority} />
                  {ticket.channel && <Chip>via {ticket.channel}</Chip>}
                </div>
                <h2 className="text-lg font-bold text-[#f4f7fc]">{ticket.title}</h2>
              </div>
              <div className="flex items-center gap-2"><code>{ticket.id}</code><CopyButton value={ticket.id} /></div>
            </div>
            <div className="mt-3 text-[12px] leading-relaxed whitespace-pre-wrap text-[#b9c5d8]">
              {ticket.description || <span className="text-[#6e7e96]">No description.</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(ticket.tags || []).length ? ticket.tags.map((x) => <Chip key={x} href={`/tickets?tag=${encodeURIComponent(x)}`}>#{x}</Chip>) : <span className="text-micro text-[#6e7e96]">No tags</span>}
            </div>
          </section>
          <Conversation comments={comments} error={errors.comments} onRetry={() => load()} />
          <Composer ticket={ticket} onPosted={afterMutation} />
          <Activity ticket={ticket} events={events} history={history} errors={errors} onRetry={() => load()} />
        </div>
        <aside className="min-w-0">
          <Properties ticket={ticket} onChanged={afterMutation} />
          <People ticket={ticket} />
          <Timeline ticket={ticket} comments={comments} />
          <Related ticket={ticket} />
          <Unsupported />
        </aside>
      </div>
      {editing && <EditTicketDialog ticket={ticket} open onOpenChange={setEditing} onSaved={() => load()} />}
      {deleting && <DeleteTicketDialog ticket={ticket} open onOpenChange={setDeleting} onDeleted={() => router.push("/tickets")} />}
    </>
  );
}

