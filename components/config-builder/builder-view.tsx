"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/desk/page-header";
import { Panel } from "@/components/desk/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { configToState, defaultState, importConfig, serialize, type BuilderState } from "@/lib/config-builder/model";
import { errorsOf, issueMap, validate } from "@/lib/config-builder/validate";
import { estimateRequests } from "@/lib/config-builder/volume";
import { elapsedConfig } from "@/lib/server/elapsed-config";
import { cn } from "@/lib/utils";
import { BuilderContext } from "./context";
import {
  AdditionalFieldsSection, CommentMappingSection, CommentsSection, GeneralSection, ImportBehaviorSection,
  StatusHistorySection, TicketMappingSection, TicketsSection, ValueMapsSection,
} from "./sections";

/** The reference Acme Desk document for this origin, as the builder state. */
export function acmeState(origin: string): BuilderState {
  const res = configToState(elapsedConfig(origin));

  if (!res.ok) throw new Error(res.error);
  return res.state;
}

const fileName = (name: string) => `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider-config"}.json`;

function Estimate({ state }: { state: BuilderState }) {
  const [tickets, setTickets] = useState("500");
  const [child, setChild] = useState("10");
  const est = estimateRequests(state, Number(tickets) || 0, Number(child) || 0);

  return (
    <Panel title="Request volume" description="Rough HTTP requests for one full sync, from the settings marked “affects requests”. Not part of the JSON.">
      <div className="grid grid-cols-2 gap-3 px-[18px] pb-3">
        <label className="grid gap-1 text-micro text-[#9aa7bc]">Tickets in scope
          <Input inputMode="numeric" value={tickets} onChange={(e) => setTickets(e.target.value)} className="font-mono text-small" />
        </label>
        <label className="grid gap-1 text-micro text-[#9aa7bc]">Items per ticket (comments / history)
          <Input inputMode="numeric" value={child} onChange={(e) => setChild(e.target.value)} className="font-mono text-small" />
        </label>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line-row px-[18px] py-3 text-small">
        <dt className="text-[#9aa7bc]">Ticket list</dt><dd className="text-right font-mono">{est.listRequests}</dd>
        <dt className="text-[#9aa7bc]">Comments</dt><dd className="text-right font-mono">{state.comments.enabled ? est.commentRequests : "off"}</dd>
        <dt className="text-[#9aa7bc]">Status history</dt><dd className="text-right font-mono">{state.statusHistory.enabled ? est.historyRequests : "off"}</dd>
        <dt className="font-bold text-[#e5eaf3]">Total</dt><dd className="text-right font-mono font-bold text-warn" data-testid="request-total">{est.total}</dd>
      </dl>
    </Panel>
  );
}

function Builder({ origin }: { origin: string }) {
  const [state, setState] = useState<BuilderState>(() => acmeState(origin));
  const [revision, setRevision] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const update = useCallback((fn: (s: BuilderState) => BuilderState) => setState(fn), []);
  const issues = useMemo(() => validate(state), [state]);
  const map = useMemo(() => issueMap(issues), [issues]);
  const json = useMemo(() => serialize(state), [state]);
  const errors = errorsOf(issues);
  const warnings = issues.length - errors.length;

  function replace(next: BuilderState, message: string, importNotes: string[] = []) {
    setState(next);
    setRevision((r) => r + 1);
    setNotes(importNotes);
    toast(message);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      toast(errors.length ? `JSON copied (${errors.length} validation error${errors.length > 1 ? "s" : ""} remain)` : "JSON copied");
    } catch {
      toast.error("Could not access the clipboard");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");

    a.href = url;
    a.download = fileName(state.displayName);
    a.click();
    URL.revokeObjectURL(url);
    if (errors.length) toast.warning(`Downloaded with ${errors.length} validation error${errors.length > 1 ? "s" : ""}`);
  }

  function applyImport(text: string) {
    const res = importConfig(text);

    if (!res.ok) return setImportError(res.error);
    setImportError("");
    setImporting(false);
    setImportText("");
    replace(res.state, "Configuration imported", res.notes);
  }

  async function onFile(file: File | undefined) {
    if (file) applyImport(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <BuilderContext.Provider value={{ state, update, issues: map, all: issues }}>
      <PageHeader
        title="Config builder"
        subtitle="Every field of the Elapsed Custom REST document is a control. The JSON on the right is generated from the form and updates as you type."
        actions={
          <>
            <Button variant="outline" onClick={() => replace(defaultState(origin), "Reset to defaults")}>Reset to defaults</Button>
            <Button variant="outline" onClick={() => replace(acmeState(origin), "Acme Desk configuration restored")}>Restore Acme Desk</Button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,520px)] items-start gap-4 max-xl:grid-cols-1">
        <div>
          <GeneralSection />
          <TicketsSection />
          <CommentsSection />
          <StatusHistorySection />
          <TicketMappingSection />
          <CommentMappingSection />
          <ValueMapsSection />
          <ImportBehaviorSection />
          <AdditionalFieldsSection revision={revision} />
        </div>
        <aside className="sticky top-4 max-xl:static">
          <Panel
            title="Generated JSON"
            description={<>Live preview of exactly what Copy and Download produce. <span className="text-[#c8d4e6]">Required</span> fields are always written; optional ones when filled.</>}
            action={
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={copy}>Copy JSON</Button>
                <Button size="xs" variant="outline" onClick={download}>Download</Button>
                <Button size="xs" variant="outline" aria-expanded={importing} onClick={() => setImporting((v) => !v)}>Import…</Button>
              </div>
            }
          >
            <div className={cn("mx-[18px] mb-3 rounded-lg border px-3 py-2 text-micro", errors.length ? "border-bad/30 bg-bad-bg text-bad" : "border-ok/30 bg-ok-bg text-ok")} role="status">
              {errors.length ? `${errors.length} validation error${errors.length > 1 ? "s" : ""}` : "Valid"}
              {warnings > 0 && ` · ${warnings} warning${warnings > 1 ? "s" : ""}`}
              {errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[#f3b3bb]">
                  {errors.slice(0, 6).map((i) => <li key={i.path + i.message}><code>{i.path}</code>: {i.message}</li>)}
                  {errors.length > 6 && <li>…and {errors.length - 6} more (shown next to each field)</li>}
                </ul>
              )}
            </div>
            {importing && (
              <div className="mx-[18px] mb-3 grid gap-2 rounded-lg border bg-deep p-3">
                <label htmlFor="import-json" className="text-small font-semibold text-[#dbe4f2]">Paste a configuration JSON, or choose a file</label>
                <Textarea id="import-json" value={importText} onChange={(e) => setImportText(e.target.value)} spellCheck={false} placeholder='{ "schemaVersion": 1, … }' className="max-h-60 min-h-28 font-mono text-small" />
                {importError && <p role="alert" className="text-micro text-bad">{importError}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!importText.trim()} onClick={() => applyImport(importText)}>Apply (replaces the form)</Button>
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Choose file…</Button>
                  <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
                </div>
              </div>
            )}
            {notes.length > 0 && (
              <details className="mx-[18px] mb-3 rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-micro text-warn" open>
                <summary className="cursor-pointer font-semibold">Import notes ({notes.length})</summary>
                <ul className="mt-1 list-disc pl-4">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </details>
            )}
            <pre aria-label="Generated JSON" className="max-h-[560px] overflow-auto bg-deep px-[18px] py-3.5 font-mono text-micro text-[#b9d9f8]">{json}</pre>
          </Panel>
          <Estimate state={state} />
        </aside>
      </div>
    </BuilderContext.Provider>
  );
}

export function ConfigBuilderView() {
  // The origin is only known in the browser; build the initial state once it is.
  const origin = useSyncExternalStore(
    () => () => {},
    () => location.origin.replace("localhost", "127.0.0.1"),
    () => "",
  );

  if (!origin) return <p className="text-small text-[#78869d]">Loading…</p>;
  return <Builder origin={origin} />;
}
