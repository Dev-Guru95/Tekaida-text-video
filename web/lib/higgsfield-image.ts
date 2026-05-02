/**
 * HiggsField Soul — text-to-image model on the same auth/transport as the
 * other HiggsField endpoints. Verified path:
 *   https://platform.higgsfield.ai/higgsfield-ai/soul/standard
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = "https://platform.higgsfield.ai";
const APPLICATION = process.env.HF_TEXT_TO_IMAGE_ENDPOINT || "higgsfield-ai/soul/standard";
const POLL_MS = 2_000;
const TERMINAL: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "nsfw",
  "canceled",
  "cancelled",
]);

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

function getApiKey(): string {
  const k = process.env.HF_KEY;
  if (k) return k;
  const apiKey = process.env.HF_API_KEY;
  const secret = process.env.HF_API_SECRET;
  if (apiKey && secret) return `${apiKey}:${secret}`;
  throw new Error("HiggsField credentials missing — set HF_KEY in web/.env.local");
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Key ${getApiKey()}`,
    "Content-Type": "application/json",
    "User-Agent": "tekaida-web/0.2",
  };
}

function pickImageUrls(payload: unknown): string[] {
  const found: string[] = [];
  function walk(node: unknown): void {
    if (typeof node === "string") {
      const lower = node.split("?", 1)[0]!.toLowerCase();
      if (IMAGE_EXTS.some((ext) => lower.endsWith(ext))) found.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  }
  walk(payload);
  return found;
}

interface SubmitResponse {
  request_id: string;
  status_url: string;
}

interface StatusPayload {
  status?: string;
  [k: string]: unknown;
}

export async function generateHiggsFieldImage(opts: {
  prompt: string;
  count: number;
  outDir: string;
  publicUrlBase: string;
  onStatus?: (s: string) => void;
}): Promise<{ imageUrls: string[] }> {
  opts.onStatus?.("submitting to HiggsField Soul");

  // Soul produces one image per call; fan out for multi-count.
  const allLocalUrls: string[] = [];
  const count = Math.min(Math.max(opts.count, 1), 4);
  await mkdir(opts.outDir, { recursive: true });

  for (let i = 0; i < count; i++) {
    const submitResp = await fetch(`${BASE_URL}/${APPLICATION}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ prompt: opts.prompt }),
    });
    if (!submitResp.ok) {
      const body = await submitResp.text();
      throw new Error(
        `HiggsField Soul submit failed (HTTP ${submitResp.status}): ${body.slice(0, 400)}`,
      );
    }
    const submitData = (await submitResp.json()) as SubmitResponse;

    let payload: StatusPayload = { status: "queued" };
    while (!TERMINAL.has(payload.status ?? "queued")) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await fetch(submitData.status_url, { headers: authHeaders() });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`HiggsField status fetch failed (HTTP ${r.status}): ${body.slice(0, 400)}`);
      }
      payload = (await r.json()) as StatusPayload;
    }

    if (payload.status !== "completed") {
      throw new Error(`HiggsField Soul shot failed: status=${payload.status}`);
    }

    const urls = pickImageUrls(payload);
    if (!urls.length) {
      throw new Error(
        `HiggsField Soul returned no image URL. Payload keys: ${Object.keys(payload).join(", ")}`,
      );
    }

    const filename = `image-${String(i + 1).padStart(2, "0")}.png`;
    const dl = await fetch(urls[0]!);
    if (!dl.ok) throw new Error(`Could not download Soul image (HTTP ${dl.status})`);
    const buf = Buffer.from(await dl.arrayBuffer());
    await writeFile(join(opts.outDir, filename), buf);
    allLocalUrls.push(`${opts.publicUrlBase}/${filename}`);
    opts.onStatus?.(`saved image ${i + 1}/${count}`);
  }

  return { imageUrls: allLocalUrls };
}
