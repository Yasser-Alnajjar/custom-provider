"use client";

import { createContext, useContext } from "react";
import { getIn, type BuilderState } from "@/lib/config-builder/model";
import type { Issue } from "@/lib/config-builder/validate";

export interface BuilderApi {
  state: BuilderState;
  /** Applies one of the pure edit functions from `lib/config-builder/model`. */
  update: (fn: (s: BuilderState) => BuilderState) => void;
  issues: Record<string, Issue>;
  all: Issue[];
}

export const BuilderContext = createContext<BuilderApi | null>(null);

export function useBuilder(): BuilderApi {
  const ctx = useContext(BuilderContext);

  if (!ctx) throw new Error("useBuilder must be used inside the configuration builder");
  return ctx;
}

export const useValue = <T,>(path: string): T => getIn(useBuilder().state, path) as T;
