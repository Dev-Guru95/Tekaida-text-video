import type { NextRequest } from "next/server";
import path from "node:path";
import { generateVeo } from "@/lib/gemini-video";
import { generateHiggsField } from "@/lib/higgsfield-video";
import { generateSora } from "@/lib/openai-video";
import { generateSeedance } from "@/lib/seedance-video";
import { getProvider } from "@/lib/providers";
import type { ProviderKey, Shot, StreamEvent } from "@/lib/types";
import { slugify } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: ProviderKey;
    shot: Shot;
    title: string;
    index: number;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (ev: StreamEvent) =>
        controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));

      try {
        const info = getProvider(body.provider);
        if (!info.available) {
          send({ type: "error", message: `${info.name} not available — ${info.missingMessage}` });
          controller.close();
          return;
        }
        if (info.cliOnly) {
          send({ type: "error", message: `${info.name} is CLI-only in this build. ${info.missingMessage}` });
          controller.close();
          return;
        }

        const slug = slugify(body.title);
        const filename = `shot-${String(body.index).padStart(2, "0")}.mp4`;
        const destPath = path.join(process.cwd(), "public", "output", slug, filename);
        // Served by /app/api/video/[...path]/route.ts — `public/` is build-time
        // only in `next start`, so we stream from disk through an API route.
        const publicUrl = `/api/video/${slug}/${filename}`;

        const onStatus = (status: string) => send({ type: "progress", status });

        let result: { videoUrl: string };
        if (body.provider === "gemini") {
          result = await generateVeo({ shot: body.shot, destPath, publicUrl, onStatus });
        } else if (body.provider === "chatgpt") {
          result = await generateSora({ shot: body.shot, destPath, publicUrl, onStatus });
        } else if (body.provider === "higgsfield") {
          result = await generateHiggsField({ shot: body.shot, destPath, publicUrl, onStatus });
        } else if (body.provider === "seedance") {
          result = await generateSeedance({ shot: body.shot, destPath, publicUrl, onStatus });
        } else {
          send({ type: "error", message: `Unsupported provider: ${body.provider}` });
          controller.close();
          return;
        }

        send({ type: "done", videoUrl: result.videoUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
