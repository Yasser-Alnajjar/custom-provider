"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { agentHref } from "@/lib/directory";
import { href, time } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { Muted, PriorityBadge, StatusBadge } from "./badges";
import { Empty } from "./panel";
import { Time } from "./time";

export const newestFirst = (a: Ticket, b: Ticket) => time(b.updated_at) - time(a.updated_at);

/** Compact ticket list used on the overview and on customer / requester / agent pages. */
export function CompactTickets({ tickets, empty = "No tickets." }: { tickets: Ticket[]; empty?: string }) {
  const router = useRouter();

  if (!tickets.length) return <Empty>{empty}</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse whitespace-nowrap">
        <thead>
          <tr>
            {["TICKET", "STATUS", "PRIORITY", "ASSIGNEE", "UPDATED"].map((h) => (
              <th key={h} className="th">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="cursor-pointer hover:bg-hover" onClick={() => router.push(href("tickets", t.id))}>
              <td className="td">
                <Link href={href("tickets", t.id)} className="link font-semibold" onClick={(e) => e.stopPropagation()}>
                  {t.id}
                </Link>
                <div className="mt-[3px] text-small text-foreground">{t.title}</div>
              </td>
              <td className="td"><StatusBadge status={t.status} /></td>
              <td className="td"><PriorityBadge priority={t.priority} /></td>
              <td className="td">
                {t.assignee ? (
                  <Link href={agentHref(t.assignee)} className="link" onClick={(e) => e.stopPropagation()}>
                    {t.assignee.name}
                  </Link>
                ) : (
                  <Muted>Unassigned</Muted>
                )}
              </td>
              <td className="td text-micro"><Time value={t.updated_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
