import type { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImagen } from "@/lib/gemini-image";
import { writeInfographic } from "@/lib/infographic-writer";
import { renderInfographicSvg } from "@/lib/infographic-svg";
import { slugify } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      try {
        const body = (await req.json()) as { concept?: string; renderImage?: boolean };
        if (!body.concept) {
          send({ type: "error", message: "concept is required" });
          controller.close();
          return;
        }

        send({ type: "progress", status: "structuring data" });
        const spec = await writeInfographic({ concept: body.concept });

        const slug = slugify(spec.title);
        const outDir = path.join(process.cwd(), "public", "output", slug);
        await mkdir(outDir, { recursive: true });
        const publicBase = `/api/video/${slug}`;

        // Always render SVG — fast, deterministic, vector-editable
        send({ type: "progress", status: "rendering SVG" });
        const svg = renderInfographicSvg(spec);
        const svgFilename = `${slug}.svg`;
        await writeFile(path.join(outDir, svgFilename), svg, "utf-8");

        // Optionally render via Imagen too — slower, photographic
        let pngUrl: string | undefined;
        if (body.renderImage !== false) {
          send({ type: "progress", status: "rendering with Imagen" });
          try {
            const { imageUrls } = await generateImagen({
              prompt: spec.imagePrompt,
              count: 1,
              aspectRatio: "1:1",
              outDir,
              publicUrlBase: publicBase,
              onStatus: (s) => send({ type: "progress", status: s }),
            });
            pngUrl = imageUrls[0];
          } catch (err) {
            // SVG already exists — Imagen is best-effort, don't fail the whole request.
            const m = err instanceof Error ? err.message : String(err);
            send({ type: "progress", status: `imagen unavailable: ${m.slice(0, 100)}` });
          }
        }

        send({
          type: "infographic",
          title: spec.title,
          subtitle: spec.subtitle,
          layout: spec.layout,
          points: spec.points,
          svgUrl: `${publicBase}/${svgFilename}`,
          pngUrl,
        });
        send({ type: "done", videoUrl: pngUrl ?? `${publicBase}/${svgFilename}` });
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
