"use client";

import {
  CAMERA_PRESETS,
  MOTION_PRESETS,
  STYLE_PRESETS,
} from "@/lib/build/presets";

/**
 * Three small chip selectors for the Workspace prompt panel. Click toggles
 * selection (clicking the active chip clears it). Each chip carries hover
 * tooltip with the preset hint so users discover what each does without
 * needing to read external docs.
 */
export function CameraChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (slug: string | null) => void;
}) {
  return (
    <div className="chip-row">
      {CAMERA_PRESETS.map((c) => (
        <button
          key={c.slug}
          type="button"
          className={`chip ${value === c.slug ? "active" : ""}`}
          title={c.hint}
          onClick={() => onChange(value === c.slug ? null : c.slug)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function MotionChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (slug: string | null) => void;
}) {
  return (
    <div className="chip-row">
      {MOTION_PRESETS.map((m) => (
        <button
          key={m.slug}
          type="button"
          className={`chip motion-${m.intensity} ${value === m.slug ? "active" : ""}`}
          title={`${m.hint} · intensity ${m.intensity}`}
          onClick={() => onChange(value === m.slug ? null : m.slug)}
        >
          {m.label}
          <span className="chip-bars" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className={i < m.intensity ? "on" : ""} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

export function StyleChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (slug: string | null) => void;
}) {
  return (
    <div className="chip-row chip-row-style">
      {STYLE_PRESETS.map((s) => (
        <button
          key={s.slug}
          type="button"
          className={`chip chip-style ${value === s.slug ? "active" : ""}`}
          title={s.hint}
          onClick={() => onChange(value === s.slug ? null : s.slug)}
          style={{
            ["--chip-c1" as string]: s.palette[0],
            ["--chip-c2" as string]: s.palette[1],
          }}
        >
          <span className="chip-style-swatch" aria-hidden="true" />
          {s.label}
        </button>
      ))}
    </div>
  );
}
