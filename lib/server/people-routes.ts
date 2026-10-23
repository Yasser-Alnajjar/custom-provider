import type { PersonKind } from "@/lib/types";
import { withDb } from "./db";
import { api, json, readBody, readText, parseBody } from "./http";
import { createPerson, deletePerson, getPerson, listPeople, updatePerson } from "./people";

type Params = { key: string };

export const collectionHandlers = (kind: PersonKind) => ({
  GET: api(async (req) => {
    const q = new URL(req.url).searchParams.get("q") || "";

    return json({ data: await withDb(false, (state) => listPeople(state, kind, q)) });
  }),
  POST: api(async (req) => {
    const body = await readBody(req);

    return json({ data: await withDb(true, (state) => createPerson(state, kind, body)) }, 201);
  }),
});

export const itemHandlers = (kind: PersonKind) => ({
  GET: api<Params>(async (_req, { params }) => {
    const { key } = await params;

    return json({ data: await withDb(false, (state) => getPerson(state, kind, key)) });
  }),
  PATCH: api<Params>(async (req, { params }) => {
    const { key } = await params;
    const raw = await readText(req);

    // The record must exist before a malformed body is reported, like tickets.
    return json({
      data: await withDb(true, (state) => {
        getPerson(state, kind, key);
        return updatePerson(state, kind, key, parseBody(raw));
      }),
    });
  }),
  DELETE: api<Params>(async (_req, { params }) => {
    const { key } = await params;

    return json({ data: await withDb(true, (state) => deletePerson(state, kind, key)) });
  }),
});
