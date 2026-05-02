import type { NextRequest } from "next/server";
import path from "node:path";
import { generateImagen } from "@/lib/gemini-image";
import { generateHiggsFieldImage } from "@/lib/higgsfield-image";
import { generateOpenAIImage } from "@/lib/openai-image";
import { getProvider } from "@/lib/providers";
import type { AspectRatio, ProviderKey, StreamEvent } from "@/lib/types";
import { slugify } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ImageEvent {
  type: "image";
  index: number;
  url: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: ProviderKey;
    prompt: string;
    title: string;
    count?: number;
    aspect?: AspectRatio;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (ev: StreamEvent | ImageEvent) =>
        controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));

      try {
        const info = getProvider(body.provider);
        if (!info.available) {
          send({ type: "error", message: `${info.name} not available — ${info.missingMessage}` });
          controller.close();
          return;
        }
        if (!info.supportedOutputs.includes("image")) {
          send({
            type: "error",
            message: `${info.name} doesn't support image generation. Switch to Gemini, OpenAI, or HiggsField.`,
          });
          controller.close();
          return;
        }

        const slug = slugify(body.title);
        const outDir = path.join(process.cwd(), "public", "output", slug);
        const publicUrlBase = `/api/video/${slug}`;
        const count = Math.min(Math.max(body.count ?? 4, 1), 4);
        const aspect = body.aspect ?? "1:1";

        const onStatus = (status: string) => send({ type: "progress", status });

        let result: { imageUrls: string[] };
        if (body.provider === "gemini") {
          result = await generateImagen({
            prompt: body.prompt,
            count,
            aspectRatio: aspect,
            outDir,
            publicUrlBase,
            onStatus,
          });
        } else if (body.provider === "chatgpt") {
          result = await generateOpenAIImage({
            prompt: body.prompt,
            count,
            aspectRatio: aspect,
            outDir,
            publicUrlBase,
            onStatus,
          });
        } else if (body.provider === "higgsfield") {
          result = await generateHiggsFieldImage({
            prompt: body.prompt,
            count,
            outDir,
            publicUrlBase,
            onStatus,
          });
        } else {
          send({ type: "error", message: `${info.name} doesn't support image generation.` });
          controller.close();
          return;
        }

        result.imageUrls.forEach((url, i) => send({ type: "image", index: i + 1, url }));
        send({ type: "done", videoUrl: result.imageUrls[0] ?? "" });
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
