"use client";

import { useEffect, useState } from "react";
import type { AspectRatio, ProviderKey, Resolution } from "@/lib/types";
import { type BuildPrefs, DEFAULT_PREFS, readPrefs, writePrefs } from "@/lib/build/prefs";

/**
 * Settings panel — defaults that ride along with every render the user
 * submits. Persisted in localStorage so they survive across sessions
 * without a round-trip to Supabase. (When a user signs in we could later
 * sync these to a `profiles` row.)
 */
export function SettingsPanel() {
  const [prefs, setPrefs] = useState<BuildPrefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  const persist = (next: Partial<BuildPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    writePrefs(merged);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Settings</h2>
          <p className="ws-sub">Defaults applied to every new render. Stored locally on this device.</p>
        </div>
        {saved && <span className="ws-saved-pill">saved</span>}
      </header>

      <div className="settings-grid">
        <Setting label="Default engine">
          <select
            className="ws-input"
            value={prefs.defaultProvider}
            onChange={(e) => persist({ defaultProvider: e.target.value as ProviderKey })}
          >
            <option value="seedance">SeaDance 2.0</option>
            <option value="gemini">Gemini Veo 3</option>
            <option value="chatgpt">OpenAI Sora 2</option>
            <option value="higgsfield">HiggsField DoP</option>
          </select>
        </Setting>
        <Setting label="Default aspect">
          <select
            className="ws-input"
            value={prefs.defaultAspect}
            onChange={(e) => persist({ defaultAspect: e.target.value as AspectRatio })}
          >
            {["16:9", "9:16", "1:1", "4:3", "9:21"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Setting>
        <Setting label="Default resolution">
          <select
            className="ws-input"
            value={prefs.defaultResolution}
            onChange={(e) => persist({ defaultResolution: e.target.value as Resolution })}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </Setting>
        <Setting label="Default duration (s)">
          <input
            type="number"
            min={2}
            max={30}
            className="ws-input"
            value={prefs.defaultDuration}
            onChange={(e) => persist({ defaultDuration: Number(e.target.value) })}
          />
        </Setting>
        <Setting label="Auto-save prompts">
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={prefs.autoSavePrompts}
              onChange={(e) => persist({ autoSavePrompts: e.target.checked })}
            />
            <span>Keep the last prompt across sessions</span>
          </label>
        </Setting>
        <Setting label="Browser notification on finish">
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={prefs.notifyOnFinish}
              onChange={(e) => persist({ notifyOnFinish: e.target.checked })}
            />
            <span>Ping me when a render completes</span>
          </label>
        </Setting>
      </div>
    </div>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      {children}
    </div>
  );
}
