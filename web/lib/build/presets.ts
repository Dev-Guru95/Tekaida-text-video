/**
 * Cinematic preset library.
 *
 * Each preset is a small piece of prompt-side metadata that the workspace
 * mixes into the user's free-text prompt before submitting to the underlying
 * video model (SeaDance 2.0 / Veo / Sora). Keeping them as data — not behavior
 * — means the same library is shared by:
 *   - the Build dashboard UI (preset chips)
 *   - the queue worker (prompt assembly)
 *   - the public API (validating preset slugs)
 */

export interface CameraPreset {
  slug: string;
  label: string;
  hint: string;             // user-facing description
  cue: string;              // text injected into the prompt
}

export interface MotionPreset {
  slug: string;
  label: string;
  hint: string;
  cue: string;
  intensity: 1 | 2 | 3;     // affects credits cost multiplier
}

export interface StylePreset {
  slug: string;
  label: string;
  hint: string;
  cue: string;
  palette: [string, string]; // accent colors for the chip
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { slug: "static",      label: "Locked-off",       hint: "no movement, tripod feel",                  cue: "static locked-off camera, tripod-mounted, no movement" },
  { slug: "dolly-in",    label: "Dolly in",         hint: "pushes toward subject",                     cue: "smooth dolly-in pushing toward the subject, slow forward translation" },
  { slug: "dolly-out",   label: "Dolly out",        hint: "pulls back, reveal",                        cue: "smooth dolly-out, pulling back to reveal the wider scene" },
  { slug: "orbit",       label: "Orbit",            hint: "circles subject 360°",                      cue: "180-degree orbital camera move around the subject, gimbal-stabilized" },
  { slug: "crane-up",    label: "Crane up",         hint: "lifts to high angle",                       cue: "crane-up move, rising from eye level to high angle, revealing scale" },
  { slug: "handheld",    label: "Handheld",         hint: "documentary, organic shake",                cue: "handheld camera with organic micro-shake, documentary feel" },
  { slug: "tracking",    label: "Tracking",         hint: "follows alongside subject",                 cue: "side-tracking dolly following the subject in motion, parallel to camera" },
  { slug: "whip-pan",    label: "Whip pan",         hint: "fast horizontal sweep",                     cue: "fast whip-pan reveal, motion-blurred horizontal sweep onto the subject" },
  { slug: "fpv",         label: "FPV drone",        hint: "first-person, immersive",                   cue: "first-person drone fly-through, smooth fast-paced FPV camera, immersive" },
  { slug: "vertigo",     label: "Dolly zoom",       hint: "vertigo / contra-zoom",                     cue: "dolly-zoom (Vertigo effect): camera dollies in while lens zooms out" },
];

export const MOTION_PRESETS: MotionPreset[] = [
  { slug: "subtle",      label: "Subtle",       hint: "gentle ambient motion",      cue: "subtle ambient motion: drifting particles, slow breathing, soft fabric sway", intensity: 1 },
  { slug: "natural",     label: "Natural",      hint: "real-world plausible",       cue: "natural plausible motion at real-world speed, physics-grounded",              intensity: 1 },
  { slug: "kinetic",     label: "Kinetic",      hint: "energetic, fast cuts",       cue: "kinetic energetic motion, dynamic momentum, fast clean choreography",         intensity: 2 },
  { slug: "slow-mo",     label: "Slow motion",  hint: "120fps super-slow look",     cue: "slow-motion 120fps look, hyper-detailed micro-movement, weighty",             intensity: 3 },
  { slug: "timelapse",   label: "Timelapse",    hint: "compressed time, fast sky",  cue: "timelapse: rapidly moving clouds and shifting light, static foreground",      intensity: 2 },
  { slug: "explosive",   label: "Explosive",    hint: "high-energy action",         cue: "explosive high-energy motion, debris, sparks, action-cinema choreography",    intensity: 3 },
];

export const STYLE_PRESETS: StylePreset[] = [
  { slug: "cinematic",     label: "Cinematic",      hint: "anamorphic, teal-orange",    cue: "anamorphic 2.39:1 cinematic look, teal-and-orange grade, lens flares, shallow depth of field", palette: ["#3ddae0", "#ff8c42"] },
  { slug: "noir",          label: "Film noir",      hint: "high-contrast B&W",          cue: "high-contrast black-and-white film noir, hard shadows, smoke, venetian-blind light",         palette: ["#0a0a0a", "#e7ecf6"] },
  { slug: "neon",          label: "Cyberpunk neon", hint: "rain, magenta + cyan",       cue: "rainy cyberpunk night, magenta and cyan neon signage, wet asphalt reflections, blade-runner mood", palette: ["#ff3df0", "#3ddae0"] },
  { slug: "wes",           label: "Symmetric pastel", hint: "Wes-Anderson centered",   cue: "perfectly centered symmetrical composition, pastel palette, deadpan staging",                  palette: ["#f9c5d1", "#9ee493"] },
  { slug: "doc",           label: "Documentary",    hint: "natural light, 16mm",        cue: "16mm documentary look, natural light, slight grain, observational handheld",                 palette: ["#c8b793", "#7c87a3"] },
  { slug: "anime",         label: "Cel anime",      hint: "Studio-Ghibli painterly",    cue: "hand-drawn cel-shaded anime, painterly Studio-Ghibli backgrounds, expressive line work",     palette: ["#7c8cff", "#ffd166"] },
  { slug: "pixar",         label: "3D animation",   hint: "stylized CG",                cue: "stylized 3D CG animation, soft global illumination, expressive character design",            palette: ["#ffb4a2", "#b5e2fa"] },
  { slug: "vhs",           label: "VHS retro",      hint: "80s home-video glitch",      cue: "1980s VHS look: chroma noise, scan lines, slight tape warping, low-fi",                       palette: ["#ff61a6", "#7c8cff"] },
  { slug: "hyperreal",     label: "Hyper-real",     hint: "8K, photographic",           cue: "hyper-realistic 8K photographic detail, sharp micro-textures, RAW look",                      palette: ["#e7ecf6", "#a59cff"] },
];

/**
 * Combine the user's prompt with selected presets into the final string we
 * send to the model. Order matters: subject first, motion next, camera, then
 * style — that's the order video models tend to weight.
 */
export function assemblePrompt(opts: {
  prompt: string;
  cameraSlug?: string | null;
  motionSlug?: string | null;
  styleSlug?: string | null;
  characterDescriptor?: string | null;
}): string {
  const parts: string[] = [opts.prompt.trim()];
  if (opts.characterDescriptor?.trim()) {
    parts.push(`Character: ${opts.characterDescriptor.trim()}`);
  }
  const motion = MOTION_PRESETS.find((m) => m.slug === opts.motionSlug);
  if (motion) parts.push(motion.cue);
  const camera = CAMERA_PRESETS.find((c) => c.slug === opts.cameraSlug);
  if (camera) parts.push(camera.cue);
  const style = STYLE_PRESETS.find((s) => s.slug === opts.styleSlug);
  if (style) parts.push(style.cue);
  return parts.join(". ");
}

export function findCamera(slug?: string | null): CameraPreset | undefined {
  return CAMERA_PRESETS.find((c) => c.slug === slug);
}
export function findMotion(slug?: string | null): MotionPreset | undefined {
  return MOTION_PRESETS.find((m) => m.slug === slug);
}
export function findStyle(slug?: string | null): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.slug === slug);
}
