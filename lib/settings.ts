/**
 * Server-side settings of the Custom Provider API that can be managed from the UI.
 *
 * Only settings that exist in the server implementation are listed here. They are separate
 * from the provider JSON (the Elapsed configuration document): for example `api.maxLimit`
 * is the largest page the API will return, while the JSON's `tickets.pagination.pageSize`
 * is the page size Elapsed asks for.
 *
 * Shared by the server (validation, resolution) and the UI (labels, bounds); no server imports.
 */

export type Group = "api" | "generator";

export interface SettingDef {
  group: Group;
  key: string;
  label: string;
  kind: "int" | "bool";
  /** Value used when neither a saved override nor the environment variable provides one. */
  builtin: number | boolean;
  min?: number;
  max?: number;
  /** Existing environment variable that supplied this value before it became editable. */
  env?: string;
  help: string;
}

export const SETTING_DEFS: SettingDef[] = [
  { group: "api", key: "defaultLimit", label: "Default page size", kind: "int", builtin: 20, min: 1, max: 5000, help: "Items per page when a list request has no ?limit. Must not exceed the maximum page size." },
  { group: "api", key: "maxLimit", label: "Maximum page size", kind: "int", builtin: 100, min: 1, max: 5000, help: "Largest page GET /api/tickets returns. A larger ?limit is capped to this value." },
  { group: "api", key: "maxBodyBytes", label: "Maximum request body (characters)", kind: "int", builtin: 1_000_000, min: 1024, max: 10_000_000, help: "Largest JSON body accepted by POST/PATCH routes; bigger bodies are rejected with 400. A hosting platform may impose a lower limit of its own." },
  { group: "generator", key: "enabled", label: "Synthetic data generator enabled", kind: "bool", builtin: true, env: "GENERATOR_ENABLED", help: "Turns the data generator endpoints on or off." },
  { group: "generator", key: "maxTickets", label: "Generator: max tickets per request", kind: "int", builtin: 1000, min: 1, max: 5000, env: "GENERATOR_MAX_TICKETS", help: "Largest count a single generation job may request." },
  { group: "generator", key: "batchSize", label: "Generator: tickets per batch", kind: "int", builtin: 50, min: 1, max: 200, env: "GENERATOR_BATCH_SIZE", help: "Tickets written per database save." },
  { group: "generator", key: "maxTotal", label: "Generator: max synthetic tickets in total", kind: "int", builtin: 5000, min: 1, max: 20_000, env: "GENERATOR_MAX_TOTAL", help: "Synthetic tickets allowed in the database at once." },
];

export interface ApiSettings {
  defaultLimit: number;
  maxLimit: number;
  maxBodyBytes: number;
}

export interface GeneratorSettings {
  enabled: boolean;
  maxTickets: number;
  batchSize: number;
  maxTotal: number;
}

export interface EffectiveSettings {
  api: ApiSettings;
  generator: GeneratorSettings;
}

/** What is saved in the database: only the values that differ from the defaults. */
export interface SettingsOverrides {
  api?: Partial<ApiSettings>;
  generator?: Partial<GeneratorSettings>;
}

export type Source = "saved" | "environment" | "default";

export interface SettingsResponse {
  overrides: SettingsOverrides;
  effective: EffectiveSettings;
  /** Values without any saved override (environment, then built-in). */
  defaults: EffectiveSettings;
  sources: Record<string, Source>;
}

export const settingPath = (d: SettingDef) => `${d.group}.${d.key}`;

/**
 * Validates a settings document. `null` (or an absent key) means "use the default".
 * Unknown groups or keys are rejected rather than stored.
 */
export function validateOverrides(
  input: unknown,
  defaults: EffectiveSettings,
): { ok: true; value: SettingsOverrides } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const value: Record<string, Record<string, number | boolean>> = {};

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { "": "Settings must be a JSON object, for example {\"api\":{\"maxLimit\":500}}." } };
  }

  for (const [group, section] of Object.entries(input)) {
    if (group !== "api" && group !== "generator") {
      errors[group] = "Unknown settings group.";
      continue;
    }
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      errors[group] = "Must be an object.";
      continue;
    }
    for (const [key, v] of Object.entries(section)) {
      const def = SETTING_DEFS.find((d) => d.group === group && d.key === key);
      const path = `${group}.${key}`;

      if (!def) errors[path] = "Unknown setting.";
      else if (v === null) continue;
      else if (def.kind === "bool") {
        if (typeof v !== "boolean") errors[path] = "Must be true or false.";
        else (value[group] ??= {})[key] = v;
      } else if (typeof v !== "number" || !Number.isInteger(v)) errors[path] = "Must be a whole number.";
      else if (v < (def.min ?? -Infinity) || v > (def.max ?? Infinity)) errors[path] = `Must be between ${def.min} and ${def.max}.`;
      else (value[group] ??= {})[key] = v;
    }
  }

  const merged = {
    defaultLimit: (value.api?.defaultLimit as number | undefined) ?? defaults.api.defaultLimit,
    maxLimit: (value.api?.maxLimit as number | undefined) ?? defaults.api.maxLimit,
  };

  if (!errors["api.defaultLimit"] && !errors["api.maxLimit"] && merged.defaultLimit > merged.maxLimit) {
    errors["api.defaultLimit"] = `Default page size (${merged.defaultLimit}) cannot exceed the maximum page size (${merged.maxLimit}).`;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: value as SettingsOverrides };
}
