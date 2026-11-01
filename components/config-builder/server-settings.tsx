"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/desk/native-select";
import { Panel } from "@/components/desk/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, getSettings, probeTickets, putSettings } from "@/lib/client/api";
import { SETTING_DEFS, settingPath, validateOverrides, type SettingDef, type SettingsOverrides, type SettingsResponse, type Source } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Tag } from "./fields";

type Draft = Record<string, string>;

const SOURCE_LABEL: Record<Source, string> = { saved: "saved", environment: "from environment", default: "default" };
const GROUPS = [
  { id: "api", title: "API behavior", note: "Applied by the running API on the very next request." },
  { id: "generator", title: "Synthetic data generator", note: "Previously only configurable through GENERATOR_* environment variables." },
] as const;

const toDraft = (o: SettingsOverrides): Draft => {
  const d: Draft = {};

  for (const def of SETTING_DEFS) {
    const v = (o[def.group] as Record<string, unknown> | undefined)?.[def.key];

    if (v !== undefined) d[settingPath(def)] = String(v);
  }
  return d;
};

/** "" means "use the default". */
function toOverrides(draft: Draft): SettingsOverrides {
  const out: Record<string, Record<string, number | boolean>> = {};

  for (const def of SETTING_DEFS) {
    const text = (draft[settingPath(def)] ?? "").trim();

    if (text === "") continue;
    (out[def.group] ??= {})[def.key] = def.kind === "bool" ? text === "true" : Number(text);
  }
  return out as SettingsOverrides;
}

function Row({ def, data, draft, error, onChange }: { def: SettingDef; data: SettingsResponse; draft: Draft; error?: string; onChange: (v: string) => void }) {
  const path = settingPath(def);
  const value = draft[path] ?? "";
  const dflt = (data.defaults[def.group] as unknown as Record<string, number | boolean>)[def.key];
  const source = data.sources[path];
  const id = `setting-${path}`;

  return (
    <div className="grid gap-1.5" data-setting={path}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-1.5 text-small font-medium text-[#dbe4f2]">
        {def.label} <code className="text-micro text-[#78869d]">{path}</code>
        <Tag tone={source === "saved" ? "volume" : "opt"}>{SOURCE_LABEL[source]}</Tag>
      </label>
      <div className="flex gap-2">
        {def.kind === "bool" ? (
          <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-56">
            <option value="">Default ({String(dflt)})</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </NativeSelect>
        ) : (
          <Input id={id} inputMode="numeric" value={value} placeholder={`Default: ${dflt}`} aria-invalid={!!error || undefined} className="w-56 font-mono text-small" onChange={(e) => onChange(e.target.value)} />
        )}
        <Button type="button" variant="ghost" size="sm" disabled={value === ""} onClick={() => onChange("")}>Use default</Button>
      </div>
      {error ? <p role="alert" className="text-micro text-bad">{error}</p> : <p className="text-micro text-[#78869d]">{def.help} {def.min !== undefined && <> Allowed: {def.min}–{def.max}. </>}{def.env && <>Environment variable: <code>{def.env}</code>.</>}</p>}
    </div>
  );
}

function Probe({ data }: { data: SettingsResponse }) {
  const [n, setN] = useState("500");
  const [result, setResult] = useState<string>("");

  async function run() {
    try {
      const res = (await probeTickets(Number(n))).data;

      setResult(`GET /api/tickets?limit=${n} → ${res.items.length} item(s); pagination.limit = ${res.pagination.limit}, total = ${res.pagination.total}, next_page = ${res.pagination.next_page ?? "null"}`);
    } catch (e) {
      setResult(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <Panel title="Try it" description={<>Calls the running API with the saved settings (currently max <b>{data.effective.api.maxLimit}</b>, default <b>{data.effective.api.defaultLimit}</b>).</>}>
      <div className="flex flex-wrap items-center gap-2 px-[18px] pb-3">
        <label htmlFor="probe-limit" className="text-small text-[#9aa7bc]">?limit=</label>
        <Input id="probe-limit" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} className="w-28 font-mono text-small" />
        <Button size="sm" variant="outline" onClick={() => void run()}>Request</Button>
      </div>
      {result && <pre data-testid="probe-result" className="overflow-x-auto bg-deep px-[18px] py-3 font-mono text-micro whitespace-pre-wrap text-[#b9d9f8]">{result}</pre>}
    </Panel>
  );
}

export function ServerSettings({ jsonPageSize, jsonSizeParam }: { jsonPageSize: string; jsonSizeParam: string }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getSettings();

      setData(res);
      setDraft(toDraft(res.overrides));
      setLoadError("");
      setServerErrors({});
    } catch (e) {
      setLoadError(e instanceof ApiError ? `${e.message}${e.status === 401 ? " — check the API token on the Provider page" : ""}` : String(e));
    }
  }, []);

  useEffect(() => {
    // Fetch once when the tab opens; state is set when the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const overrides = useMemo(() => toOverrides(draft), [draft]);
  const checked = useMemo(() => (data ? validateOverrides(overrides, data.defaults) : null), [overrides, data]);
  const errors = { ...(checked && !checked.ok ? checked.errors : {}), ...serverErrors };
  const dirty = data ? JSON.stringify(overrides) !== JSON.stringify(data.overrides) : false;

  async function save() {
    setSaving(true);
    try {
      const res = await putSettings(overrides);

      setData(res);
      setDraft(toDraft(res.overrides));
      setServerErrors({});
      toast("Server settings saved — the API uses them now");
    } catch (e) {
      const map: Record<string, string> = {};

      if (e instanceof ApiError) for (const part of e.message.split("; ")) { const i = part.indexOf(": "); if (i > 0) map[part.slice(0, i)] = part.slice(i + 2); }
      setServerErrors(Object.keys(map).length ? map : { "": e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <Panel title="Server settings"><p className="px-[18px] pb-4 text-small text-bad">{loadError} <Button variant="link" size="sm" onClick={() => void load()}>Retry</Button></p></Panel>;
  if (!data) return <p className="text-small text-[#78869d]">Loading server settings…</p>;

  const size = Number(jsonPageSize);
  const max = data.effective.api.maxLimit;

  return (
    <div>
      <Panel
        title="Provider JSON vs. server limits"
        description="Two independent settings: the provider JSON says what page size Elapsed asks for; the server setting is the most it will ever return."
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-[18px] pb-3 text-small">
          <dt className="text-[#9aa7bc]">Provider JSON <code>tickets.pagination.pageSize</code> (sent as <code>{jsonSizeParam || "—"}</code>)</dt>
          <dd className="font-mono">{jsonPageSize || "not set"}</dd>
          <dt className="text-[#9aa7bc]">Server <code>api.maxLimit</code></dt>
          <dd className="font-mono">{max}</dd>
        </dl>
        {Number.isFinite(size) && size > max && (
          <p className="mx-[18px] mb-3 rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-micro text-warn">
            The provider JSON asks for pages of {size}, but this server returns at most {max}. Elapsed follows <code>next_page</code>, so it still gets everything, with more requests than the JSON suggests. Raise <code>api.maxLimit</code> or lower <code>pageSize</code>.
          </p>
        )}
      </Panel>

      {GROUPS.map((g) => (
        <Panel key={g.id} title={g.title} description={g.note}>
          <div className="grid gap-5 px-[18px] pb-4">
            {SETTING_DEFS.filter((d) => d.group === g.id).map((def) => (
              <Row key={settingPath(def)} def={def} data={data} draft={draft} error={errors[settingPath(def)]} onChange={(v) => setDraft((d) => ({ ...d, [settingPath(def)]: v }))} />
            ))}
          </div>
        </Panel>
      ))}
      {errors[""] && <p role="alert" className="mb-3 text-small text-bad">{errors[""]}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || saving || (checked ? !checked.ok : true)} onClick={() => void save()}>{saving ? "Saving…" : "Save server settings"}</Button>
        <Button variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(toDraft(data.overrides)); setServerErrors({}); }}>Discard changes</Button>
        <Button variant="outline" disabled={saving || Object.keys(data.overrides).length === 0} onClick={() => setDraft({})}>Reset everything to defaults</Button>
        <span className={cn("text-small", dirty ? "text-warn" : "text-[#78869d]")}>{dirty ? "Unsaved changes — not applied yet" : "Saved settings are in use"}</span>
      </div>

      <Probe data={data} />

      <Panel title="Not editable here" description="These are not part of this feature on purpose.">
        <ul className="list-disc space-y-1 px-[34px] pb-4 text-micro text-[#8794aa]">
          <li><code>API_TOKEN</code>, <code>SUPABASE_*</code>, <code>DB_FILE</code>, <code>PORT</code>: secrets and deployment settings. They are needed to reach this page or the database, so they stay environment-only.</li>
          <li>Rate limits, request timeouts and a record cap on comments / history / events: the server has none, so there is nothing to configure.</li>
        </ul>
      </Panel>
    </div>
  );
}
