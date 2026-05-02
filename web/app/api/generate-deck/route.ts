import type { NextRequest } from "next/server";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeDeck } from "@/lib/deck-writer";
import { renderDeckToFile } from "@/lib/deck-render";
import { slugify } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      try {
        const body = (await req.json()) as { concept?: string; slideCount?: number };
        if (!body.concept) {
          send({ type: "error", message: "concept is required" });
          controller.close();
          return;
        }

        send({ type: "progress", status: "writing slide structure" });
        const spec = await writeDeck({
          concept: body.concept,
          slideCount: body.slideCount,
        });

        const slug = slugify(spec.title);
        const filename = `${slug}.pptx`;
        const outDir = path.join(process.cwd(), "public", "output", slug);
        const destPath = path.join(outDir, filename);
        await mkdir(outDir, { recursive: true });

        send({ type: "progress", status: `rendering ${spec.slides.length} slides` });
        await renderDeckToFile(spec, destPath);

        send({
          type: "deck",
          title: spec.title,
          subtitle: spec.subtitle,
          slideCount: spec.slides.length,
          downloadUrl: `/api/video/${slug}/${filename}`,
          outline: spec.slides.map((s) => ({ title: s.title, bullets: s.bullets })),
        });
        send({ type: "done", videoUrl: `/api/video/${slug}/${filename}` });
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
    },
  });
}
