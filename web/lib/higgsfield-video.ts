/**
 * HiggsField Cloud video provider, ported from `higgsfield_client` (Python).
 *
 * Wire protocol (verified against the Python SDK at platform.higgsfield.ai):
 *   - Auth:    `Authorization: Key {HF_KEY}`  where HF_KEY is "key:secret"
 *   - Submit:  POST  https://platform.higgsfield.ai/{application}
 *              body = JSON arguments
 *              -> { request_id, status_url, cancel_url }
 *   - Poll:    GET   {status_url}
 *              -> { status: "queued"|"in_progress"|"completed"|"failed"|"nsfw"|"canceled", ...result }
 *   - Result:  same status_url returns the result payload once status === "completed".
 *
 * Result payload shape varies by application; we walk it for the first string
 * ending in a known video extension (mirrors `_pick_video_url` in the Python).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Shot } from "./types";

const BASE_URL = "https://platform.higgsfield.ai";
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".m4v"];
const POLL_MS = 2_000;
const TERMINAL: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "nsfw",
  "canceled",
  "cancelled",
]);

function getApiKey(): string {
  const k = process.env.HF_KEY;
  if (k) return k;
  const apiKey = process.env.HF_API_KEY;
  const secret = process.env.HF_API_SECRET;
  if (apiKey && secret) return `${apiKey}:${secret}`;
  throw new Error(
    "HiggsField credentials missing — set HF_KEY (or HF_API_KEY + HF_API_SECRET) in web/.env.local",
  );
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Key ${getApiKey()}`,
    "Content-Type": "application/json",
    "User-Agent": "claude-higgs-field-web/0.1",
  };
}

/**
 * Validate that a reference image URL is well-formed and points to an actual
 * image. Returns the cleaned (trimmed) URL on success; throws a clear,
 * actionable error otherwise. We sanitize whitespace because pasted URLs
 * often pick up stray spaces that the URL constructor accepts but the
 * downstream image-to-video service rejects.
 */
async function assertImageUrlIsValid(url: string): Promise<string> {
  const cleaned = url.trim();
  if (!cleaned) {
    throw new Error("Reference image URL is empty.");
  }
  if (/\s/.test(cleaned)) {
    throw new Error(
      `Reference image URL contains whitespace ("${cleaned.slice(0, 80)}…"). ` +
        `Re-copy the URL — your paste picked up extra spaces or line breaks.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(
      `Reference image URL is malformed: "${cleaned.slice(0, 100)}". Paste a direct https:// link to a JPG/PNG/WebP file.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Reference image URL must use http or https. Got: ${parsed.protocol}`,
    );
  }

  let head: Response;
  try {
    head = await fetch(cleaned, { method: "HEAD", redirect: "follow" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    throw new Error(
      `Could not reach reference image URL (${msg}). Paste a direct image URL — e.g. one ending in .jpg, .png, or .webp.`,
    );
  }

  if (!head.ok) {
    throw new Error(
      `Reference image URL returned HTTP ${head.status}. Paste a direct, publicly accessible image URL.`,
    );
  }

  const contentType = (head.headers.get("content-type") || "").toLowerCase();
  // Only reject when content-type is *explicitly* not an image. Many image
  // CDNs (imgix, Cloudflare Images) omit Content-Type on HEAD responses —
  // treat missing as "probably fine, let the downstream service decide."
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(
      `Reference image URL must point to an image, not "${contentType}". ` +
        `Looks like you pasted a webpage URL — open the image in your browser, right-click → Copy image address, ` +
        `and paste that. The URL should typically end in .jpg/.png/.webp.`,
    );
  }
  console.log(
    `[higgsfield] image preflight OK url=${cleaned.slice(0, 100)} status=${head.status} content-type="${contentType || "(none)"}" length=${head.headers.get("content-length") || "?"}`,
  );

  return cleaned;
}

function pickVideoUrl(payload: unknown): string | null {
  function walk(node: unknown): string | null {
    if (typeof node === "string") {
      const lower = node.split("?", 1)[0]!.toLowerCase();
      if (VIDEO_EXTS.some((ext) => lower.endsWith(ext))) return node;
      return null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    if (node && typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) {
        const found = walk(v);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(payload);
}

interface SubmitResponse {
  request_id: string;
  status_url: string;
  cancel_url?: string;
}

interface StatusPayload {
  status?: string;
  [k: string]: unknown;
}

export interface HiggsFieldOptions {
  shot: Shot;
  destPath: string;
  publicUrl: string;
  onStatus?: (s: string) => void;
  /** Override the HiggsField application endpoint strings for this call.
   *  Used by sibling providers (e.g. Seedance) that route through the same
   *  HiggsField transport but target a different model. */
  applicationOverride?: { textToVideo?: string; imageToVideo?: string };
  /** Label prepended to status events ("submitting to {label}"). */
  label?: string;
  /** When true (default), throw an upfront error if the user didn't supply an
   *  image_url and the provider hasn't configured a text-to-video fallback. */
  requireImageUrl?: boolean;
}

export async function generateHiggsField(opts: HiggsFieldOptions): Promise<{ videoUrl: string }> {
  const i2v =
    opts.applicationOverride?.imageToVideo ||
    process.env.HF_IMAGE_TO_VIDEO_ENDPOINT ||
    "higgsfield-ai/dop/standard";
  const t2v = opts.applicationOverride?.textToVideo;

  // Pick endpoint based on whether the user supplied an image. If no image was
  // supplied and the provider didn't configure a text-to-video endpoint, we
  // require an image (most HiggsField models are image-to-video only).
  let application: string;
  if (opts.shot.image_url) {
    application = i2v;
  } else if (t2v) {
    application = t2v;
  } else if (opts.requireImageUrl ?? true) {
    throw new Error(
      "This HiggsField model is image-to-video only — paste a reference image URL into the form field before generating.",
    );
  } else {
    // Fallback: send to the i2v endpoint and let HiggsField return its error.
    application = i2v;
  }
  const label = opts.label ?? "HiggsField";

  // Body shape per HiggsField docs example for Kling/Seedance image-to-video:
  // strictly { image_url, prompt }. We omit `duration` because some models
  // return generic 500s when it's set to a value they don't accept, and
  // the API uses sensible defaults when it's omitted.
  const args: Record<string, unknown> = {
    image_url: opts.shot.image_url,
    prompt: opts.shot.prompt,
  };

  // Pre-flight: verify image_url is actually a reachable image. HiggsField
  // returns an unhelpful 500 when the URL points at HTML, has whitespace,
  // or 404s. We catch that here and surface a clear message instead, AND
  // we use the cleaned URL in the request body to avoid sending stray spaces.
  let cleanImageUrl: string | undefined;
  if (opts.shot.image_url) {
    cleanImageUrl = await assertImageUrlIsValid(opts.shot.image_url);
    args.image_url = cleanImageUrl;
  }

  opts.onStatus?.(`submitting to ${label}`);

  const submitUrl = `${BASE_URL}/${application}`;
  const keyLen = (process.env.HF_KEY || "").length;
  console.log(
    `[higgsfield] POST ${submitUrl}\n  args: ${JSON.stringify(args)}\n  HF_KEY length: ${keyLen}`,
  );

  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(args),
  });
  if (!submitResp.ok) {
    const text = await submitResp.text();
    const headerSummary: string[] = [];
    submitResp.headers.forEach((v, k) => {
      if (
        k.startsWith("x-") ||
        k === "content-type" ||
        k === "retry-after" ||
        k === "www-authenticate"
      ) {
        headerSummary.push(`${k}: ${v}`);
      }
    });
    console.log(
      `[higgsfield] submit failed: HTTP ${submitResp.status}\n  body=${text.slice(0, 500)}\n  response headers:\n    ${headerSummary.join("\n    ")}`,
    );
    throw new Error(
      `HiggsField submit failed (HTTP ${submitResp.status}): ${text.slice(0, 500)}`,
    );
  }
  const submitData = (await submitResp.json()) as SubmitResponse;
  const statusUrl = submitData.status_url;
  if (!statusUrl) throw new Error("HiggsField submit returned no status_url");

  let payload: StatusPayload = { status: "queued" };
  let lastStatus = "queued";
  opts.onStatus?.(lastStatus);

  while (!TERMINAL.has(payload.status ?? "queued")) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const r = await fetch(statusUrl, { headers: authHeaders() });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(
        `HiggsField status fetch failed (HTTP ${r.status}): ${t.slice(0, 500)}`,
      );
    }
    payload = (await r.json()) as StatusPayload;
    const next = payload.status ?? "queued";
    if (next !== lastStatus) {
      opts.onStatus?.(next);
      lastStatus = next;
    }
  }

  if (payload.status !== "completed") {
    throw new Error(`HiggsField shot failed: status=${payload.status}`);
  }

  const videoUrl = pickVideoUrl(payload);
  if (!videoUrl) {
    throw new Error(
      `HiggsField returned no video URL. Payload keys: ${Object.keys(payload).join(", ")}`,
    );
  }

  opts.onStatus?.("downloading");
  const dl = await fetch(videoUrl);
  if (!dl.ok) {
    throw new Error(`Could not download HiggsField video (HTTP ${dl.status})`);
  }
  await mkdir(dirname(opts.destPath), { recursive: true });
  const buf = Buffer.from(await dl.arrayBuffer());
  await writeFile(opts.destPath, buf);

  return { videoUrl: opts.publicUrl };
}
