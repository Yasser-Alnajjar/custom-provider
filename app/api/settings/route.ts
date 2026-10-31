import { withDb } from "@/lib/server/db";
import { api, json, preflight, readBody } from "@/lib/server/http";
import { compact, describeSettings, effectiveSettings } from "@/lib/server/settings";
import { validateOverrides } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Server settings: saved overrides, effective values, defaults and where each value comes from. */
export const GET = api(async () => json({ data: await withDb(false, (state) => describeSettings(state.settings)) }));

/**
 * Replaces the saved overrides with the given document. A missing or null value means "use the
 * default" (environment variable, then built-in), so sending `{}` resets everything.
 */
export const PUT = api(async (req) => {
  const body = await readBody(req);
  const checked = validateOverrides(body, effectiveSettings(undefined));

  if (!checked.ok) {
    const message = Object.entries(checked.errors).map(([k, v]) => `${k}: ${v}`).join("; ");

    return json({ error: "validation_error", message, details: checked.errors }, 400);
  }

  return json({
    data: await withDb(true, (state) => {
      const saved = compact(checked.value);

      if (saved) state.settings = saved;
      else delete state.settings;
      return describeSettings(state.settings);
    }),
  });
});
