"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addComment } from "@/lib/client/api";
import { useActor } from "@/lib/client/storage";
import { displayName } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NativeSelect } from "../native-select";

type Mode = "public" | "internal";

export function Composer({ ticket, onPosted }: { ticket: Ticket; onPosted: () => Promise<unknown> }) {
  const actor = useActor();
  const [mode, setMode] = useState<Mode>("public");
  const [draft, setDraft] = useState("");
  const [authorIdx, setAuthorIdx] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const internal = mode === "internal";

  const options = [{ label: `${actor.name} (you, agent)`, author: actor as object }];

  if (ticket.assignee?.id && ticket.assignee.id !== actor.id) {
    options.push({ label: `${ticket.assignee.name} (assignee)`, author: { id: ticket.assignee.id, name: ticket.assignee.name, role: "agent" } });
  }

  if (!internal && ticket.requester) {
    options.push({
      label: `${displayName(ticket.requester)} (requester, simulate customer reply)`,
      author: { id: ticket.requester.id, name: displayName(ticket.requester), role: "customer" },
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const body = draft.trim();

    if (!body) return setError("Write something first.");

    setBusy(true);
    try {
      await addComment({ ticket_id: ticket.id, body, author: options[authorIdx]?.author ?? options[0].author, isPublic: !internal });
      setDraft("");
      toast(internal ? "Internal note added" : "Reply sent");
      await onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); setAuthorIdx(0); }}
      aria-pressed={mode === m}
      className={cn("rounded-md px-2.5 py-1 text-micro text-[#8794aa]", mode === m && "bg-[#162338] text-[#e1f4ff]")}
    >
      {label}
    </button>
  );

  return (
    <section className={cn("mb-4 rounded-[10px] border bg-card", internal && "border-[#6a5427] bg-[#1f1a0f]")}>
      <div className="flex flex-wrap items-center gap-1 px-3.5 pt-3">
        {tab("public", "Public reply")}
        {tab("internal", "🔒︎ Internal note")}
        <span className="ml-2 text-micro text-[#78869d]">
          {internal ? "Only agents can see internal notes. Elapsed treats them as non-public." : "Visible to the requester."}
        </span>
      </div>
      <form ref={form} onSubmit={submit} className="grid gap-2.5 p-3.5">
        <Textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }}
          placeholder={internal ? "Write an internal note…" : "Write a reply…"}
          aria-label="Comment text"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-micro text-[#8794aa]">
            Post as
            <NativeSelect value={authorIdx} onChange={(e) => setAuthorIdx(Number(e.target.value))}>
              {options.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
            </NativeSelect>
          </label>
          <Button type="submit" disabled={busy}>{internal ? "Add note" : "Send reply"}</Button>
        </div>
        <div role="alert" className="min-h-4 text-small text-bad">{error}</div>
      </form>
    </section>
  );
}
