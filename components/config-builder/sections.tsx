"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/desk/native-select";
import {
  COMMENT_MAPPING, HISTORY_MAPPING, KNOWN_VALUES, PAGINATION_TYPES, TICKET_MAPPING, VALUE_MAPS, paginationType,
  type MapFieldDef,
} from "@/lib/config-builder/contract";
import { setExtras, setField } from "@/lib/config-builder/model";
import { useBuilder, useValue } from "./context";
import { Field, KeyValueEditor, SelectField, Tag, TextField, Toggle } from "./fields";

export function Section({
  id, title, description, prefixes, defaultOpen, badge, children,
}: {
  id: string; title: string; description: string; prefixes: string[]; defaultOpen?: boolean; badge?: React.ReactNode; children: React.ReactNode;
}) {
  const { all } = useBuilder();
  const mine = all.filter((i) => prefixes.some((p) => i.path === p || i.path.startsWith(`${p}.`)));
  const errors = mine.filter((i) => i.severity === "error").length;
  const warnings = mine.length - errors;

  return (
    <details id={id} open={defaultOpen} className="group mb-3 overflow-hidden rounded-[10px] border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-3.5 select-none hover:bg-hover [&::-webkit-details-marker]:hidden">
        <span className="text-[#6e7e96] transition-transform group-open:rotate-90" aria-hidden>▸</span>
        <h2 className="text-[13px] font-bold text-[#f4f7fc]">{title}</h2>
        {badge}
        {errors > 0 && <span className="rounded bg-bad-bg px-1.5 py-px text-nano font-bold text-bad">{errors} error{errors > 1 ? "s" : ""}</span>}
        {warnings > 0 && <span className="rounded bg-warn-bg px-1.5 py-px text-nano font-bold text-warn">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
        <span className="basis-full text-micro text-[#78869d] sm:ml-6 sm:basis-auto">{description}</span>
      </summary>
      <div className="grid gap-5 border-t border-line-row px-[18px] py-4">{children}</div>
    </details>
  );
}

const Group = ({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) => (
  <fieldset className="grid gap-3">
    <legend className="mb-1 flex items-center gap-2 text-nano font-bold tracking-[0.6px] text-[#6e7e96] uppercase">{title}{note}</legend>
    {children}
  </fieldset>
);

const options = (known: readonly string[]) => known.map((v) => ({ value: v, label: v }));

export function PaginationEditor({ base }: { base: "tickets" | "comments" | "statusHistory" }) {
  const path = `${base}.pagination`;
  const id = useId();
  const { update, issues } = useBuilder();
  const type = useValue<string>(`${path}.type`) ?? "";
  const def = paginationType(type);
  const typeOptions = [{ value: "", label: "Not set (omit)" }, ...PAGINATION_TYPES.map((t) => ({ value: t.value, label: t.label }))];
  const all = typeOptions.some((o) => o.value === type) ? typeOptions : [...typeOptions, { value: type, label: `${type} (not verified)` }];
  const issue = issues[`${path}.type`];

  return (
    <Group title="Pagination" note={<Tag tone="volume" title="Page size and type decide how many requests a sync makes">affects requests</Tag>}>
      <Field path={`${path}.type`} label="type" required={base === "tickets"} help={def?.help} htmlFor={id}>
        <NativeSelect id={id} value={type} aria-invalid={issue?.severity === "error" || undefined} onChange={(e) => update((s) => setField(s, `${path}.type`, e.target.value))}>
          {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
      </Field>
      {def && def.params.length > 0 && (
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {def.params.map((p) => (
            <TextField key={p.key} path={`${path}.values.${p.key}`} label={p.key} required={p.required} volume={p.volume} help={p.help} placeholder={p.placeholder} mono={p.kind === "string"} />
          ))}
        </div>
      )}
      {type !== "" && !def && <p className="text-micro text-warn">Fields of this pagination type are kept exactly as imported; edit them under Additional fields → {path}.</p>}
    </Group>
  );
}

export function EndpointEditor({ base, perTicket }: { base: "tickets" | "comments" | "statusHistory"; perTicket: boolean }) {
  return (
    <>
      <Group title="Request">
        <div className="grid grid-cols-[140px_1fr] gap-3 max-sm:grid-cols-1">
          <TextField path={`${base}.request.method`} label="method" required suggestions={KNOWN_VALUES.method} placeholder="GET" />
          <TextField
            path={`${base}.request.path`}
            label="path"
            required
            placeholder={perTicket ? "/tickets/{{ticket.id}}/…" : "/tickets"}
            help={perTicket ? "Fetched once per ticket (more requests with more tickets). {{ticket.id}} is replaced by the ticket id." : "Relative to connection.baseUrl."}
            volume={perTicket}
          />
        </div>
        <KeyValueEditor
          path={`${base}.request.query`}
          title="Query parameters"
          keyLabel="name"
          valueLabel="value"
          keyPlaceholder="parameter"
          valuePlaceholder="value or {{updatedSince}}"
          addLabel="Add parameter"
          empty="No query parameters. The query object is omitted from the JSON."
        />
      </Group>
      <Group title="Response">
        <TextField path={`${base}.itemsPath`} label="itemsPath" required placeholder="$.data.items[*]" help="JSONPath that selects the array of items in the response." />
      </Group>
      <PaginationEditor base={base} />
    </>
  );
}

export function GeneralSection() {
  return (
    <Section id="general" title="General" description="Identity, connection and authentication" prefixes={["schemaVersion", "displayName", "baseUrl", "authType", "extras.auth", "extras.connection"]} defaultOpen>
      <div className="grid grid-cols-[140px_1fr] gap-3 max-sm:grid-cols-1">
        <TextField path="schemaVersion" label="schemaVersion" required placeholder="1" help="Document format version (whole number)." />
        <TextField path="displayName" label="displayName" required mono={false} placeholder="My Ticket Provider" />
      </div>
      <TextField path="baseUrl" label="connection.baseUrl" required placeholder="https://api.example.com" help="Absolute URL; request paths are appended to it. Use 127.0.0.1 rather than localhost for a local server." />
      <Group title="Authentication">
        <SelectField path="authType" label="auth.type" required options={options(KNOWN_VALUES.authType)} help="Secrets such as the token are never part of this document; they are entered in Elapsed's Connection step." />
      </Group>
    </Section>
  );
}

export function TicketsSection() {
  const enabled = useValue<boolean>("incremental.enabled");

  return (
    <Section id="tickets" title="Tickets" description="Ticket list request, pagination and incremental sync" prefixes={["tickets", "incremental"]} defaultOpen badge={<Tag tone="req">required</Tag>}>
      <EndpointEditor base="tickets" perTicket={false} />
      <Group title="Incremental sync" note={<Tag tone="volume" title="Incremental sync limits what is re-fetched">affects requests</Tag>}>
        <Toggle path="incremental.enabled" label="Include incremental" help="Writes the tickets.incremental object. When off the object is left out of the JSON and its values are kept here. It takes effect through {{updatedSince}} in a ticket query parameter." />
        {enabled && (
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <TextField path="incremental.format" label="format" suggestions={KNOWN_VALUES.incrementalFormat} placeholder="iso8601" help="How {{updatedSince}} is rendered." />
            <TextField path="incremental.lookbackSeconds" label="lookbackSeconds" volume placeholder="300" help="Overlap re-read on each sync to avoid missing late updates." />
          </div>
        )}
      </Group>
    </Section>
  );
}

export function CommentsSection() {
  const enabled = useValue<boolean>("comments.enabled");

  return (
    <Section id="comments" title="Comments" description="Per-ticket comment requests" prefixes={["comments", "commentMapping"]} badge={<Tag tone={enabled ? "volume" : "opt"}>{enabled ? "enabled · 1+ request per ticket" : "disabled"}</Tag>}>
      <Toggle path="comments.enabled" label="Include comments" help="The document has no on/off key, so off means the comments object is left out of the JSON. Its values stay in the form and come back when switched on again." />
      {enabled && <EndpointEditor base="comments" perTicket />}
    </Section>
  );
}

export function StatusHistorySection() {
  const enabled = useValue<boolean>("statusHistory.enabled");

  return (
    <Section id="history" title="Status History" description="Per-ticket status transition requests" prefixes={["statusHistory"]} badge={<Tag tone={enabled ? "volume" : "opt"}>{enabled ? "enabled · 1+ request per ticket" : "disabled"}</Tag>}>
      <Toggle path="statusHistory.enabled" label="Include status history" help="The document has no on/off key, so off means the statusHistory object (with its mapping) is left out of the JSON. Its values stay in the form and come back when switched on again." />
      {enabled && (
        <>
          <EndpointEditor base="statusHistory" perTicket />
          <MappingGroup title="Status history mapping" base="statusHistory.mapping" defs={HISTORY_MAPPING} />
        </>
      )}
    </Section>
  );
}

function MappingGroup({ title, base, defs }: { title: string; base: string; defs: MapFieldDef[] }) {
  return (
    <Group title={title}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {defs.map((d) => (
          <TextField key={d.key} path={`${base}.${d.key}`} label={d.label} required={d.required} help={d.help} placeholder={d.placeholder} />
        ))}
      </div>
    </Group>
  );
}

export function TicketMappingSection() {
  return (
    <Section id="ticket-mapping" title="Ticket Mapping" description="JSONPath of each ticket field in the list response" prefixes={["mapping"]}>
      <MappingGroup title="mapping" base="mapping" defs={TICKET_MAPPING} />
    </Section>
  );
}

export function CommentMappingSection() {
  const enabled = useValue<boolean>("comments.enabled");

  return (
    <Section id="comment-mapping" title="Comment Mapping" description="JSONPath of each comment field" prefixes={["commentMapping"]}>
      {!enabled && <p className="text-micro text-warn">Comments are disabled: the mapping is still exported but its fields are not validated.</p>}
      <MappingGroup title="commentMapping" base="commentMapping" defs={COMMENT_MAPPING} />
    </Section>
  );
}

export function ValueMapsSection() {
  return (
    <Section id="value-maps" title="Value Maps" description="Translate provider values to Elapsed values" prefixes={["valueMaps"]}>
      {VALUE_MAPS.map((m) => (
        <KeyValueEditor
          key={m.key}
          path={`valueMaps.${m.key}`}
          title={`valueMaps.${m.key}`}
          help={m.help}
          keyLabel="provider value"
          valueLabel="Elapsed value"
          keyPlaceholder="provider value"
          valuePlaceholder="Elapsed value"
          addLabel="Add entry"
          empty="No entries; this map is omitted from the JSON."
        />
      ))}
    </Section>
  );
}

export function ImportBehaviorSection() {
  return (
    <Section id="import" title="Import Behavior" description="Unknown statuses, import window, SLA and ticket links" prefixes={["unknownStatus", "importWindowDays", "slaMode", "creationActorType", "ticketUrlTemplate", "extras.creationActor"]}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <TextField path="unknownStatus" label="unknownStatus" suggestions={KNOWN_VALUES.unknownStatus} placeholder="fail" help="What happens when a status is missing from the status value map." />
        <TextField path="importWindowDays" label="importWindowDays" volume placeholder="90" help="How far back the first import reaches. A longer window means more tickets and requests." />
        <TextField path="slaMode" label="slaMode" suggestions={KNOWN_VALUES.slaMode} placeholder="full" />
        <TextField path="creationActorType" label="creationActor.type" suggestions={KNOWN_VALUES.creationActorType} placeholder="first_comment_author" />
      </div>
      <TextField path="ticketUrlTemplate" label="ticketUrlTemplate" placeholder="https://desk.example.com/tickets/{id}" help="Link to a ticket in the provider. {id} is replaced by the ticket id." />
    </Section>
  );
}

/** One preserved value, edited according to its JSON type. The key itself is fixed. */
function ExtraValue({ path, name, value }: { path: string; name: string; value: unknown }) {
  const { update, issues } = useBuilder();
  const id = useId();
  const [text, setText] = useState(() => (typeof value === "number" ? String(value) : JSON.stringify(value, null, 2)));
  const [bad, setBad] = useState("");
  const set = (v: unknown) => update((s) => setExtras(s, path, { ...s.extras[path], [name]: v }));
  const label = path ? `${path}.${name}` : name;
  const collision = issues[`extras.${path}`];

  let control: React.ReactNode;

  if (typeof value === "string") {
    control = <Input id={id} value={value} spellCheck={false} className="font-mono text-small" onChange={(e) => set(e.target.value)} />;
  } else if (typeof value === "boolean") {
    control = (
      <NativeSelect id={id} value={String(value)} onChange={(e) => set(e.target.value === "true")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </NativeSelect>
    );
  } else if (typeof value === "number") {
    control = (
      <Input
        id={id}
        value={text}
        inputMode="decimal"
        aria-invalid={!!bad || undefined}
        className="font-mono text-small"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(Number(e.target.value))) {
            setBad("");
            set(Number(e.target.value));
          } else setBad("Not applied: enter a number.");
        }}
      />
    );
  } else {
    control = (
      <Textarea
        id={id}
        value={text}
        spellCheck={false}
        aria-invalid={!!bad || undefined}
        className="min-h-12 font-mono text-small"
        onChange={(e) => {
          setText(e.target.value);
          try {
            set(JSON.parse(e.target.value));
            setBad("");
          } catch (err) {
            setBad(`Not applied: ${err instanceof Error ? err.message : "invalid JSON"}`);
          }
        }}
      />
    );
  }

  return (
    <div className="grid gap-1" data-field={`extras.${label}`}>
      <Label htmlFor={id} className="flex-wrap gap-1.5 text-small">
        <span className="font-mono">{label}</span>
        <Tag tone="opt">{Array.isArray(value) ? "array" : value === null ? "null" : typeof value}</Tag>
      </Label>
      {control}
      {bad && <p role="alert" className="text-micro text-bad">{bad}</p>}
      {!bad && collision && <p className="text-micro text-bad">{collision.message}</p>}
    </div>
  );
}

export function AdditionalFieldsSection({ revision }: { revision: number }) {
  const { state } = useBuilder();
  const paths = Object.keys(state.extras);
  const count = paths.reduce((n, p) => n + Object.keys(state.extras[p]).length, 0);

  return (
    <Section id="additional" title="Additional fields" description="Values from the document that no dedicated control can show" prefixes={["extras"]} badge={count > 0 ? <Tag tone="opt">{count} preserved</Tag> : undefined}>
      <p className="text-micro text-[#78869d]">
        Keys this builder has no control for, and values whose JSON type differs from the control (for example an object where a string is expected), appear here. They are exported unchanged and can be edited as their own type; keys cannot be added or renamed.
      </p>
      {count === 0 && <p className="rounded-lg border border-dashed px-3 py-2 text-micro text-[#78869d]">Nothing to preserve: every key in the document has a control.</p>}
      {paths.map((p) => (
        <div key={`${revision}:${p}`} className="grid gap-3">
          {Object.entries(state.extras[p]).map(([k, v]) => <ExtraValue key={`${revision}:${p}:${k}`} path={p} name={k} value={v} />)}
        </div>
      ))}
    </Section>
  );
}

