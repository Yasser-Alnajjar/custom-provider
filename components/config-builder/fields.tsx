"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/desk/native-select";
import { kvAdd, kvRemove, kvUpdate, setField, type KV, type ValueKind } from "@/lib/config-builder/model";
import { cn } from "@/lib/utils";
import { useBuilder, useValue } from "./context";

export function Tag({ tone, children, title }: { tone: "req" | "opt" | "volume"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "rounded px-1.5 py-px text-nano font-bold tracking-[0.4px] uppercase",
        tone === "req" && "bg-bad-bg text-bad",
        tone === "opt" && "bg-secondary text-[#8794aa]",
        tone === "volume" && "bg-warn-bg text-warn",
      )}
    >
      {children}
    </span>
  );
}

/** Label + requirement badge + help, with the validation message for `path` rendered underneath. */
export function Field({
  path, label, required, volume, help, htmlFor, children, className,
}: {
  path: string; label: string; required?: boolean; volume?: boolean; help?: string; htmlFor: string; children: React.ReactNode; className?: string;
}) {
  const issue = useBuilder().issues[path];

  return (
    <div className={cn("grid content-start gap-1.5", className)} data-field={path}>
      <Label htmlFor={htmlFor} className="flex-wrap gap-1.5 text-small">
        <span className="font-mono">{label}</span>
        <Tag tone={required ? "req" : "opt"}>{required ? "required" : "optional"}</Tag>
        {volume && <Tag tone="volume" title="Changes how many HTTP requests a sync makes">affects requests</Tag>}
      </Label>
      {children}
      {issue ? (
        <p id={`${htmlFor}-msg`} role={issue.severity === "error" ? "alert" : undefined} className={cn("text-micro", issue.severity === "error" ? "text-bad" : "text-warn")}>
          {issue.message}
        </p>
      ) : (
        help && <p id={`${htmlFor}-msg`} className="text-micro text-[#78869d]">{help}</p>
      )}
    </div>
  );
}

export function TextField({
  path, label, required, volume, help, placeholder, suggestions, mono = true, className,
}: {
  path: string; label: string; required?: boolean; volume?: boolean; help?: string; placeholder?: string; suggestions?: readonly string[]; mono?: boolean; className?: string;
}) {
  const id = useId();
  const { update, issues } = useBuilder();
  const value = useValue<string>(path);
  const issue = issues[path];

  return (
    <Field path={path} label={label} required={required} volume={volume} help={help} htmlFor={id} className={className}>
      <Input
        id={id}
        value={value ?? ""}
        placeholder={placeholder}
        list={suggestions ? `${id}-list` : undefined}
        aria-invalid={issue?.severity === "error" || undefined}
        aria-describedby={`${id}-msg`}
        spellCheck={false}
        autoComplete="off"
        className={cn(mono && "font-mono text-small")}
        onChange={(e) => update((s) => setField(s, path, e.target.value))}
      />
      {suggestions && <datalist id={`${id}-list`}>{suggestions.map((v) => <option key={v} value={v} />)}</datalist>}
    </Field>
  );
}

export function SelectField({
  path, label, required, volume, help, options, className,
}: {
  path: string; label: string; required?: boolean; volume?: boolean; help?: string; options: { value: string; label: string }[]; className?: string;
}) {
  const id = useId();
  const { update } = useBuilder();
  const value = useValue<string>(path) ?? "";
  // A value outside the verified list (for example from an import) stays selectable.
  const all = options.some((o) => o.value === value) ? options : [...options, { value, label: value === "" ? "Not set" : `${value} (not verified)` }];

  return (
    <Field path={path} label={label} required={required} volume={volume} help={help} htmlFor={id} className={className}>
      <NativeSelect id={id} value={value} aria-describedby={`${id}-msg`} onChange={(e) => update((s) => setField(s, path, e.target.value))}>
        {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </Field>
  );
}

export function Toggle({ path, label, help }: { path: string; label: string; help?: string }) {
  const id = useId();
  const { update, issues } = useBuilder();
  const checked = useValue<boolean>(path);
  const issue = issues[path];

  return (
    <div className="grid gap-1" data-field={path}>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-body font-medium text-[#dbe4f2]">
        <input id={id} type="checkbox" role="switch" className="size-4 accent-[var(--primary)]" checked={!!checked} onChange={(e) => update((s) => setField(s, path, e.target.checked))} />
        {label}
      </label>
      {help && <p className="pl-6 text-micro text-[#78869d]">{help}</p>}
      {issue && <p className={cn("pl-6 text-micro", issue.severity === "error" ? "text-bad" : "text-warn")}>{issue.message}</p>}
    </div>
  );
}

/** Editable list of key → value pairs (query parameters, value maps). Rows can be added, edited and removed. */
export function KeyValueEditor({
  path, title, keyLabel, valueLabel, keyPlaceholder, valuePlaceholder, addLabel, empty, help,
}: {
  path: string; title: string; keyLabel: string; valueLabel: string; keyPlaceholder?: string; valuePlaceholder?: string; addLabel: string; empty: string; help?: string;
}) {
  const { state, update, issues } = useBuilder();
  const rows = useValue<KV[]>(path) ?? [];
  const base = useId();

  void state;
  return (
    <div className="grid gap-2" data-field={path}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-small font-semibold text-[#dbe4f2]">{title} <Tag tone="opt">optional</Tag></div>
          {help && <p className="text-micro text-[#78869d]">{help}</p>}
        </div>
        <Button type="button" variant="outline" size="xs" onClick={() => update((s) => kvAdd(s, path))}>+ {addLabel}</Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-micro text-[#78869d]">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row, i) => {
            const k = issues[`${path}.${i}.key`];
            const v = issues[`${path}.${i}.value`];
            const msg = k ?? v;

            return (
              <li key={row.id} className="grid gap-1" data-row={`${path}.${i}`}>
                <div className="grid grid-cols-[1fr_1fr_92px_auto] gap-2 max-sm:grid-cols-[1fr_1fr]">
                  <Input
                    aria-label={`${title} ${keyLabel} ${i + 1}`}
                    aria-invalid={k?.severity === "error" || undefined}
                    aria-describedby={msg ? `${base}-${i}` : undefined}
                    placeholder={keyPlaceholder ?? keyLabel}
                    value={row.key}
                    spellCheck={false}
                    className="font-mono text-small"
                    onChange={(e) => update((s) => kvUpdate(s, path, row.id, { key: e.target.value }))}
                  />
                  <Input
                    aria-label={`${title} ${valueLabel} ${i + 1}`}
                    aria-invalid={v?.severity === "error" || undefined}
                    aria-describedby={msg ? `${base}-${i}` : undefined}
                    placeholder={valuePlaceholder ?? valueLabel}
                    value={row.value}
                    spellCheck={false}
                    className="font-mono text-small max-sm:col-span-1 max-sm:row-start-2"
                    onChange={(e) => update((s) => kvUpdate(s, path, row.id, { value: e.target.value }))}
                  />
                  <NativeSelect
                    aria-label={`${title} value type ${i + 1}`}
                    value={row.kind}
                    title="JSON type of the value"
                    onChange={(e) => update((s) => kvUpdate(s, path, row.id, { kind: e.target.value as ValueKind }))}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </NativeSelect>
                  <Button type="button" variant="destructive" size="icon" aria-label={`Remove ${title} ${i + 1}`} onClick={() => update((s) => kvRemove(s, path, row.id))}>×</Button>
                </div>
                {msg && <p id={`${base}-${i}`} role="alert" className={cn("text-micro", msg.severity === "error" ? "text-bad" : "text-warn")}>{msg.message}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
