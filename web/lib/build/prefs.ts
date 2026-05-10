/**
 * Build workspace user preferences. Stored in localStorage so they survive
 * page reloads. Shared between WorkspacePanel (which reads them as the
 * initial form state) and SettingsPanel (which mutates them).
 */

import type { AspectRatio, ProviderKey, Resolution } from "@/lib/types";

export const PREFS_STORAGE_KEY = "tekaida.build.settings.v1";

export interface BuildPrefs {
  defaultProvider: ProviderKey;
  defaultAspect: AspectRatio;
  defaultResolution: Resolution;
  defaultDuration: number;
  autoSavePrompts: boolean;
  notifyOnFinish: boolean;
}

export const DEFAULT_PREFS: BuildPrefs = {
  defaultProvider: "seedance",
  defaultAspect: "16:9",
  defaultResolution: "720p",
  defaultDuration: 5,
  autoSavePrompts: true,
  notifyOnFinish: true,
};

export function readPrefs(): BuildPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<BuildPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(next: BuildPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage full / disabled — ignore */
  }
}

const PROMPT_KEY = "tekaida.build.lastPrompt.v1";

export function readLastPrompt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PROMPT_KEY);
  } catch {
    return null;
  }
}

export function writeLastPrompt(prompt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROMPT_KEY, prompt);
  } catch {
    /* ignore */
  }
}
