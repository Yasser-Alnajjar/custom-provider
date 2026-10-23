"use client";

import { useSyncExternalStore } from "react";

export const DEFAULT_TOKEN = "demo_elapsed";
const TOKEN_KEY = "acmedesk.token";
const ACTOR_KEY = "acmedesk.actor";

export interface Actor {
  id?: string;
  name: string;
  role: "agent";
}

export const DEFAULT_ACTOR: Actor = { id: "agent-demo", name: "Demo Agent", role: "agent" };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); the session just won't persist */
  }
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export const getToken = () => read(TOKEN_KEY) || DEFAULT_TOKEN;
export const setToken = (token: string) =>
  write(TOKEN_KEY, token && token !== DEFAULT_TOKEN ? token : null);

// The server has no user accounts, so "who am I" is a local choice used as the
// author of comments written from this UI.
let actorCache: { raw: string; actor: Actor } = { raw: "", actor: DEFAULT_ACTOR };

export function getActor(): Actor {
  const raw = read(ACTOR_KEY) ?? "";

  if (raw === actorCache.raw) return actorCache.actor;

  let actor = DEFAULT_ACTOR;

  try {
    const parsed = JSON.parse(raw || "null") as { id?: string; name?: string } | null;
    if (parsed?.name) actor = { id: parsed.id || undefined, name: parsed.name, role: "agent" };
  } catch {
    /* fall through to the default */
  }

  actorCache = { raw, actor };
  return actor;
}

export const setActor = (actor: { id?: string; name: string }) =>
  write(ACTOR_KEY, JSON.stringify(actor));

export function useActor(): Actor {
  return useSyncExternalStore(subscribe, getActor, () => DEFAULT_ACTOR);
}

export function useToken(): string {
  return useSyncExternalStore(subscribe, getToken, () => DEFAULT_TOKEN);
}
