import { SETTING_DEFS, settingPath, type EffectiveSettings, type SettingDef, type SettingsOverrides, type SettingsResponse, type Source } from "@/lib/settings";

/**
 * Resolution order for every setting: saved override (stored in the database next to the data,
 * so it survives restarts and is shared by all instances) > the existing environment variable
 * (where one exists) > built-in default.
 */

function fromEnv(def: SettingDef): number | boolean | undefined {
  const raw = def.env ? process.env[def.env] : undefined;

  if (def.kind === "bool") return def.env && raw !== undefined ? raw !== "0" : undefined;
  const n = Number(raw);

  // Same rule the generator limits always had: invalid or too-small values fall back, large ones are capped.
  return raw !== undefined && Number.isInteger(n) && n >= (def.min ?? 1) ? Math.min(n, def.max ?? n) : undefined;
}

const read = (o: SettingsOverrides | undefined, def: SettingDef) => (o?.[def.group] as Record<string, number | boolean> | undefined)?.[def.key];

function resolve(overrides?: SettingsOverrides): { value: EffectiveSettings; sources: Record<string, Source> } {
  const value = { api: {}, generator: {} } as Record<string, Record<string, number | boolean>>;
  const sources: Record<string, Source> = {};

  for (const def of SETTING_DEFS) {
    const saved = read(overrides, def);
    const env = fromEnv(def);

    value[def.group][def.key] = saved ?? env ?? def.builtin;
    sources[settingPath(def)] = saved !== undefined ? "saved" : env !== undefined ? "environment" : "default";
  }
  const out = value as unknown as EffectiveSettings;

  // A default can never exceed the maximum, whatever combination of sources produced them.
  out.api.defaultLimit = Math.min(out.api.defaultLimit, out.api.maxLimit);
  return { value: out, sources };
}

export const effectiveSettings = (overrides?: SettingsOverrides): EffectiveSettings => resolve(overrides).value;

/** Defaults and effective values without (or with) the saved overrides, plus where each value comes from. */
export function describeSettings(overrides?: SettingsOverrides): SettingsResponse {
  const { value, sources } = resolve(overrides);

  return { overrides: overrides ?? {}, effective: value, defaults: resolve(undefined).value, sources };
}

/** Drops empty groups so "all defaults" is stored as nothing at all. */
export function compact(o: SettingsOverrides): SettingsOverrides | undefined {
  const out: SettingsOverrides = {};

  if (o.api && Object.keys(o.api).length) out.api = o.api;
  if (o.generator && Object.keys(o.generator).length) out.generator = o.generator;
  return Object.keys(out).length ? out : undefined;
}
