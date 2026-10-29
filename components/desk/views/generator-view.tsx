"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  advanceGeneration,
  ApiError,
  cancelGeneration,
  getGenerator,
  purgeSynthetic,
  resumeGeneration,
  startGeneration,
  type GeneratorOverview,
} from "@/lib/client/api";
import { humanize, plural } from "@/lib/format";
import type { GenerationProgress } from "@/lib/types";
import { useDesk } from "../data-provider";
import { PageHeader } from "../page-header";
import { Empty, ErrorState, Notice, Panel, StatGrid } from "../panel";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PAUSE_MS = 150; // between batches, so normal API traffic is never starved

function Bar({ job }: { job: GenerationProgress }) {
  const pct = job.requested ? Math.round((job.cursor / job.requested) * 100) : 0;

  return (
    <div
      role="progressbar"
      aria-label="Generation progress"
      aria-valuemin={0}
      aria-valuemax={job.requested}
      aria-valuenow={job.cursor}
      className="h-2 overflow-hidden rounded-full bg-deep"
    >
      <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Summary({ job }: { job: GenerationProgress }) {
  if (job.status === "completed") {
    return <Notice tone="subtle">Done: exactly {plural(job.processed, "synthetic ticket")} generated and stored in {plural(job.batches, "batch")}.</Notice>;
  }
  if (job.status === "failed") {
    return <Notice>Failed: {job.error || "unknown error"}. {plural(job.processed, "ticket")} were saved; nothing was duplicated.</Notice>;
  }
  if (job.status === "cancelled") {
    return <Notice>Stopped at {job.processed} of {job.requested}. Resume to finish the remaining {job.remaining}.</Notice>;
  }
  return null;
}

export function GeneratorView() {
  const { reload } = useDesk();
  const [overview, setOverview] = useState<GeneratorOverview | null>(null);
  const [error, setError] = useState("");
  const [count, setCount] = useState("100");
  const [busy, setBusy] = useState(false); // a submit or purge is in flight
  const [driving, setDriving] = useState(false); // this tab is advancing a job
  const keyRef = useRef<string | null>(null); // idempotency key for the current submission
  const stop = useRef(false);
  const [halted, setHalted] = useState(false); // a batch request failed: wait for the user instead of looping
  const active = useRef(false); // exactly one driver loop per tab

  const load = useCallback(async () => {
    try {
      setOverview(await getGenerator());
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; state is set once the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patch = (job: GenerationProgress) =>
    setOverview((o) => (o ? { ...o, items: o.items.map((j) => (j.id === job.id ? job : j)) } : o));

  /** Advances the job batch by batch until it finishes, is stopped, or fails. */
  const drive = useCallback(
    async (first: GenerationProgress) => {
      if (active.current) return;
      active.current = true;
      stop.current = false;
      setHalted(false);
      setDriving(true);
      let job = first;

      try {
        while (job.status === "running" && !stop.current) {
          job = await advanceGeneration(job.id);
          patch(job);
          await new Promise((r) => setTimeout(r, PAUSE_MS));
        }
      } catch (e) {
        setHalted(true);
        toast.error(message(e));
      } finally {
        active.current = false;
        setDriving(false);
        await load();
        await reload();
      }

      if (job.status === "completed") toast.success(`Generated ${job.processed} synthetic tickets`);
    },
    [load, reload],
  );

  const running = overview?.items.find((j) => j.status === "running");
  const limits = overview?.limits;
  const requested = Number(count);
  const valid = Number.isInteger(requested) && requested >= 1 && !!limits && requested <= limits.maxTickets;
  const locked = busy || driving || !!running || !limits?.enabled;

  // A running job found on load (another tab, or a reload) is continued from here.
  useEffect(() => {
    if (running && !halted) void drive(running);
  }, [running, halted, drive]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !valid) return;

    // The same key is reused if this submit is retried, so it cannot create a second job.
    keyRef.current ??= `ui-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const job = await startGeneration(requested, keyRef.current);

      keyRef.current = null;
      await load();
      void drive(job);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 0) keyRef.current = null;
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<GenerationProgress>) {
    try {
      const job = await fn();

      await load();
      if (job.status === "running") void drive(job);
    } catch (err) {
      toast.error(message(err));
    }
  }

  async function purge() {
    if (!confirm("Delete every synthetic ticket? Real tickets are not affected.")) return;
    setBusy(true);
    try {
      const { deleted } = await purgeSynthetic();

      toast.success(`Deleted ${plural(deleted, "synthetic ticket")}`);
      await load();
      await reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  const latest = overview?.items[0];

  return (
    <>
      <PageHeader
        title="Data generator"
        subtitle="Create synthetic tickets through the same data contract Elapsed syncs from. Every ticket is tagged synthetic and uses @synthetic.invalid addresses."
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && overview && !limits?.enabled && <Notice>The generator is disabled on this server (GENERATOR_ENABLED=0).</Notice>}

      <Panel title="Generate tickets" description={limits && `Up to ${limits.maxTickets} per request, written in batches of ${limits.batchSize}. ${overview?.synthetic_tickets ?? 0} of ${limits.maxTotal} synthetic tickets exist.`}>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t border-line-row px-[18px] py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="count">Number of tickets</Label>
            <Input
              id="count"
              type="number"
              inputMode="numeric"
              min={1}
              max={limits?.maxTickets}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={locked}
              aria-invalid={!valid}
              className="w-40"
            />
          </div>
          <Button type="submit" disabled={locked || !valid}>
            {busy || driving ? "Generating…" : "Generate Tickets"}
          </Button>
          {!valid && <span className="pb-2 text-micro text-bad">Enter a whole number from 1 to {limits?.maxTickets ?? "…"}.</span>}
        </form>
      </Panel>

      <Panel title="Status" description="Progress is stored on the server, so it survives a page reload.">
        {!overview ? (
          <Empty>Loading…</Empty>
        ) : !latest ? (
          <Empty>No generation has been run yet.</Empty>
        ) : (
          <div className="grid gap-4 px-[18px] pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-small">
              <span>
                <code>{latest.id}</code> · {humanize(latest.status)} · {plural(latest.batches, "batch")}
              </span>
              <span className="flex gap-2">
                {latest.status === "running" && halted && <Button size="sm" onClick={() => void drive(latest)}>Retry batch</Button>}
                {latest.status === "running" && <Button variant="outline" size="sm" onClick={() => { stop.current = true; void act(() => cancelGeneration(latest.id)); }}>Stop</Button>}
                {(latest.status === "cancelled" || latest.status === "failed") && !latest.failed && !running && (
                  <Button variant="outline" size="sm" onClick={() => act(() => resumeGeneration(latest.id))}>Resume</Button>
                )}
              </span>
            </div>
            <Bar job={latest} />
            <StatGrid
              items={[
                { label: "Requested", value: latest.requested },
                { label: "Generated", value: latest.generated, tone: "blue" },
                { label: "Processed", value: latest.processed, note: "stored and readable via the API", tone: "green" },
                { label: "Failed", value: latest.failed, tone: "amber" },
                { label: "Remaining", value: latest.remaining },
              ]}
            />
            <Summary job={latest} />
          </div>
        )}
      </Panel>

      <Panel title="Clean up" description="Removes synthetic tickets and their history only.">
        <div className="flex items-center gap-3 border-t border-line-row px-[18px] py-4">
          <Button variant="outline" onClick={purge} disabled={busy || driving || !!running || !overview?.synthetic_tickets}>
            Delete synthetic tickets
          </Button>
          <span className="text-micro text-[#78869d]">{plural(overview?.synthetic_tickets ?? 0, "synthetic ticket")}</span>
        </div>
      </Panel>
    </>
  );
}
