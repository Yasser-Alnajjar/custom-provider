"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTicket, patchTicket } from "@/lib/client/api";
import { requesterKey } from "@/lib/directory";
import { humanize } from "@/lib/format";
import { buildCreateBody, buildPatch } from "@/lib/ticket-payload";
import { CHANNELS, PRIORITIES, STATUSES, type Ticket } from "@/lib/types";
import { useDesk } from "./data-provider";
import { NativeSelect } from "./native-select";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

function Options({ values }: { values: readonly string[] }) {
  return values.map((v) => (
    <option key={v} value={v}>
      {humanize(v)}
    </option>
  ));
}

function useChannels(current?: string | null) {
  const { tickets } = useDesk();
  return [...new Set([...CHANNELS, ...tickets.map((t) => t.channel), current].filter((c): c is string => Boolean(c)))];
}

/** Runs the submit handler, keeping the dialog open (and the input intact) on failure. */
function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return { error, busy, onSubmit };
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (ticket: Ticket) => void;
}) {
  const { directory, reload } = useDesk();
  const channels = useChannels("web");
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "normal",
    status: "open",
    channel: "web",
    assigneeId: "",
    tags: "",
    email: "",
    requesterName: "",
    customerKey: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // Returning requesters: fill in their name from the directory.
  function onEmail(e: React.ChangeEvent<HTMLInputElement>) {
    const known = directory.requesters.get(requesterKey({ email: e.target.value.trim() }));
    setForm((f) => ({ ...f, email: e.target.value, requesterName: known?.name ?? f.requesterName }));
  }

  const { error, busy, onSubmit } = useSubmit(async () => {
    const created = await createTicket(buildCreateBody(form, directory));

    toast.success(`${created.id} created`);
    onOpenChange(false);
    await reload();
    onCreated?.(created);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={onSubmit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Create a ticket</DialogTitle>
            <DialogDescription>Add a record to the provider API dataset.</DialogDescription>
          </DialogHeader>
          <Field label="Ticket title">
            <Input required value={form.title} onChange={set("title")} placeholder="Briefly describe the issue" />
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={set("description")} placeholder="Additional details…" />
          </Field>
          <Row>
            <Field label="Priority">
              <NativeSelect value={form.priority} onChange={set("priority")}><Options values={PRIORITIES} /></NativeSelect>
            </Field>
            <Field label="Status">
              <NativeSelect value={form.status} onChange={set("status")}><Options values={STATUSES} /></NativeSelect>
            </Field>
          </Row>
          <Row>
            <Field label="Channel">
              <NativeSelect value={form.channel} onChange={set("channel")}><Options values={channels} /></NativeSelect>
            </Field>
            <Field label="Assignee">
              <NativeSelect value={form.assigneeId} onChange={set("assigneeId")}>
                <option value="">Unassigned</option>
                {[...directory.agents.values()].map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </NativeSelect>
            </Field>
          </Row>
          <Field label="Tags">
            <Input value={form.tags} onChange={set("tags")} placeholder="billing, bug (comma separated)" />
          </Field>
          <Row>
            <Field label="Requester email">
              <Input type="email" required list="knownRequesters" autoComplete="off" value={form.email} onChange={onEmail} placeholder="name@company.com" />
            </Field>
            <Field label="Requester name">
              <Input required value={form.requesterName} onChange={set("requesterName")} placeholder="Full name" />
            </Field>
          </Row>
          <datalist id="knownRequesters">
            {[...directory.requesters.values()].map((r) => (
              <option key={r.key} value={r.email ?? ""}>{r.name}</option>
            ))}
          </datalist>
          <Field label="Customer">
            <NativeSelect value={form.customerKey} onChange={set("customerKey")}>
              <option value="">Automatic (requester&apos;s customer, else server default)</option>
              {[...directory.customers.values()].map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <div role="alert" className="min-h-4 text-small text-bad">{error}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create ticket</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditTicketDialog({
  ticket,
  open,
  onOpenChange,
  onSaved,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { directory, reload } = useDesk();
  const channels = useChannels(ticket.channel);
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description || "",
    channel: ticket.channel || "",
    customerKey: ticket.customer?.id || ticket.customer?.name || "",
    tags: (ticket.tags || []).join(", "),
    requesterName: ticket.requester?.name || "",
    email: ticket.requester?.email || "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { error, busy, onSubmit } = useSubmit(async () => {
    const patch = buildPatch(ticket, form, directory);

    if (!Object.keys(patch).length) {
      onOpenChange(false);
      toast("No changes to save");
      return;
    }

    await patchTicket(ticket.id, patch);
    toast.success(`${ticket.id} updated`);
    onOpenChange(false);
    await reload();
    onSaved?.();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={onSubmit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Edit {ticket.id}</DialogTitle>
            <DialogDescription>Changes are saved to the provider API.</DialogDescription>
          </DialogHeader>
          <Field label="Ticket title">
            <Input required value={form.title} onChange={set("title")} />
          </Field>
          <Field label="Description">
            <Textarea rows={4} value={form.description} onChange={set("description")} />
          </Field>
          <Row>
            <Field label="Channel">
              <NativeSelect value={form.channel} onChange={set("channel")}><Options values={channels} /></NativeSelect>
            </Field>
            <Field label="Customer">
              <NativeSelect value={form.customerKey} onChange={set("customerKey")}>
                {[...directory.customers.values()].map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          </Row>
          <Field label="Tags">
            <Input value={form.tags} onChange={set("tags")} placeholder="comma separated" />
          </Field>
          <Row>
            <Field label="Requester name">
              <Input required value={form.requesterName} onChange={set("requesterName")} />
            </Field>
            <Field label="Requester email">
              <Input type="email" required value={form.email} onChange={set("email")} />
            </Field>
          </Row>
          <div role="alert" className="min-h-4 text-small text-bad">{error}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
