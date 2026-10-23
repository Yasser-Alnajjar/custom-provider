import { api, errorResponse, preflight } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const POST = api(() =>
  errorResponse(
    403,
    "disabled",
    "Delete the database file (DB_FILE) and restart the app to reset the data.",
  ),
);
