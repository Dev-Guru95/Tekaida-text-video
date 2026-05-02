/**
 * Streams generated MP4s (and other media) from disk.
 *
 * Why this exists: Next.js's `public/` directory is captured at *build time*
 * by `next start`. Files written into `public/output/` at runtime (e.g. by
 * /api/generate-shot) are NOT served as static assets in production — the
 * static handler returns 404. This route reads the file from disk on demand
 * and streams it back with the right Content-Type, which works in both dev
 * and production.
 *
 * Path traversal is prevented by sanitizing each segment to only allow
 * word characters, hyphen, and dot.
 */

import type { NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  if (!segments?.length) return new Response("Not found", { status: 404 });

  // Strip anything that's not a word character, hyphen, or dot — blocks "..".
  const safe = segments
    .map((s) => s.replace(/[^\w\-.]/g, ""))
    .filter(Boolean);
  if (!safe.length) return new Response("Not found", { status: 404 });

  const filePath = path.join(process.cwd(), "public", "output", ...safe);

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return new Response("Not found", { status: 404 });
    }
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeFor(filePath),
        "Content-Length": String(fileStat.size),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
