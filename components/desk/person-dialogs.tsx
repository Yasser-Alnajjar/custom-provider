"use client";

import { useRouter } from "next/navigation";
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
import { createPerson, deletePerson, updatePerson } from "@/lib/client/api";
import { href } from "@/lib/format";
import type { PersonKind, PersonRecord } from "@/lib/types";
import { useDesk } from "./data-provider";
import { Field, useSubmit } from "./ticket-dialogs";

const NOUN: Record<PersonKind, string> = { customers: "customer", requesters: "requester", agents: "agent" };

/** What the dialogs need to know about an existing person. */
export interface PersonTarget {
  key: string;
  name: string;
  id?: string | null;
  email?: string | null;
  /** Tickets (and for agents, events) that refer to the person; deletion is blocked while > 0. */
  refs: number;
}

export function PersonFormDialog({
  kind,
  person,
  open,
  onOpenChange,
  onSaved,
}: {
  kind: PersonKind;
  /** Present when editing. */
  person?: PersonTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (record: PersonRecord) => void;
}) {
  const { reload } = useDesk();
  const noun = NOUN[kind];
  const [form, setForm] = useState({ name: person?.name ?? "", email: person?.email ?? "", id: person?.id ?? "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { error, busy, onSubmit } = useSubmit(async () => {
    const body: Record<string, unknown> = { name: form.name.trim() };

    if (kind === "requesters") body.email = form.email.trim();

    let record: PersonRecord;

    if (person) {
      record = await updatePerson(kind, person.key, body);
    } else {
      if (form.id.trim()) body.id = form.id.trim();
      record = await createPerson(kind, body);
    }

    toast.success(`${record.name} ${person ? "updated" : "created"}`);
    onOpenChange(false);
    await reload();
    onSaved?.(record);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={onSubmit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>{person ? `Edit ${person.name}` : `Create a ${noun}`}</DialogTitle>
            <DialogDescription>
              {person
                ? `The new name is also applied to every ticket that refers to this ${noun}.`
                : `Add a ${noun} to the provider API dataset.`}
            </DialogDescription>
          </DialogHeader>
          <Field label="Name">
            <Input required autoFocus value={form.name} onChange={set("name")} />
          </Field>
          {kind === "requesters" && (
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={set("email")} placeholder="name@company.com" />
            </Field>
          )}
          <Field label={kind === "agents" ? "Agent ID" : "ID (optional)"}>
            <Input
              value={form.id}
              onChange={set("id")}
              disabled={Boolean(person)}
              placeholder={kind === "agents" ? "Generated from the name when empty" : "Leave empty to identify by name"}
            />
          </Field>
          <div role="alert" className="min-h-4 text-small text-bad">{error}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{person ? "Save changes" : `Create ${noun}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePersonDialog({
  kind,
  person,
  open,
  onOpenChange,
  onDeleted,
}: {
  kind: PersonKind;
  person: PersonTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { reload } = useDesk();
  const noun = NOUN[kind];
  const blocked = person.refs > 0;
  const { error, busy, onSubmit } = useSubmit(async () => {
    await deletePerson(kind, person.key);
    toast.success(`${person.name} deleted`);
    onOpenChange(false);
    void reload();
    onDeleted?.();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={onSubmit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Delete {person.name}?</DialogTitle>
            <DialogDescription>
              {blocked
                ? `This ${noun} is referenced by existing tickets or their history, so it cannot be deleted. Delete or reassign those tickets first.`
                : `This permanently removes the ${noun} from the provider API. It cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <div role="alert" className="min-h-4 text-small text-bad">{error}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy || blocked}>Delete {noun}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit and Delete buttons (with their dialogs) for a detail page header. */
export function PersonActions({ kind, person }: { kind: PersonKind; person: PersonTarget }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  return (
    <>
      <Button onClick={() => setDialog("edit")}>✎ Edit</Button>
      <Button variant="destructive" onClick={() => setDialog("delete")}>Delete</Button>
      {dialog === "edit" && (
        <PersonFormDialog
          kind={kind}
          person={person}
          open
          onOpenChange={() => setDialog(null)}
          // The key can change with the name or email, so follow the record to its new address.
          onSaved={(r) => r.key !== person.key && router.replace(href(kind, r.key))}
        />
      )}
      {dialog === "delete" && (
        <DeletePersonDialog kind={kind} person={person} open onOpenChange={() => setDialog(null)} onDeleted={() => router.push(`/${kind}`)} />
      )}
    </>
  );
}

export function CreatePersonButton({ kind }: { kind: PersonKind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>＋ New {NOUN[kind]}</Button>
      {open && <PersonFormDialog kind={kind} open onOpenChange={setOpen} onSaved={(r) => router.push(href(kind, r.key))} />}
    </>
  );
}
