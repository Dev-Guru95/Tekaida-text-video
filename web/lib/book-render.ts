/**
 * Assemble a BookSpec + per-chapter illustrations into a downloadable PDF.
 *
 * Layout: cover spread (full-bleed illustration with title/subtitle overlay
 * styling), then for each chapter a full-page illustration followed by a
 * full-page text page. Letter portrait, generous margins.
 */

import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { BookSpec } from "./book-writer";

const PAGE_W = 612;   // 8.5 inches × 72
const PAGE_H = 792;   // 11 inches × 72
const MARGIN = 56;
const BG = rgb(11 / 255, 15 / 255, 30 / 255);
const TITLE_COLOR = rgb(1, 1, 1);
const SUBTITLE_COLOR = rgb(139 / 255, 139 / 255, 1);
const ACCENT = rgb(61 / 255, 218 / 255, 224 / 255);
const BODY = rgb(231 / 255, 236 / 255, 246 / 255);
const MUTED = rgb(124 / 255, 135 / 255, 163 / 255);

const IMAGEN_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001";

async function imagenPng(client: GoogleGenAI, prompt: string): Promise<Uint8Array> {
  const resp = await client.models.generateImages({
    model: IMAGEN_MODEL,
    prompt,
    config: { numberOfImages: 1, aspectRatio: "1:1" },
  });
  const generated = resp.generatedImages ?? [];
  const bytes = generated[0]?.image?.imageBytes;
  if (!bytes) throw new Error("Imagen returned no image for prompt.");
  return Buffer.from(bytes, "base64");
}

function wrap(text: string, font: import("pdf-lib").PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderBookToFile(opts: {
  spec: BookSpec;
  destPath: string;
  onStatus?: (s: string) => void;
}): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const client = new GoogleGenAI({ apiKey });

  const pdf = await PDFDocument.create();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);
  const italicFont = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const drawBg = (page: import("pdf-lib").PDFPage) =>
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BG });

  // ----- Cover -----
  opts.onStatus?.("rendering cover illustration");
  const coverBytes = await imagenPng(client, opts.spec.coverPrompt);
  const coverImg = await pdf.embedPng(coverBytes);
  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  drawBg(cover);
  // Cover image fills the top 60% of the page
  const imgW = PAGE_W - MARGIN * 2;
  const imgH = imgW;
  cover.drawImage(coverImg, {
    x: MARGIN,
    y: PAGE_H - MARGIN - imgH,
    width: imgW,
    height: imgH,
  });
  // Accent bar
  cover.drawRectangle({
    x: MARGIN,
    y: PAGE_H - MARGIN - imgH - 24,
    width: 60,
    height: 3,
    color: ACCENT,
  });
  // Title
  const titleSize = 30;
  const titleLines = wrap(opts.spec.title, titleFont, titleSize, PAGE_W - MARGIN * 2);
  let cursorY = PAGE_H - MARGIN - imgH - 48 - titleSize;
  for (const line of titleLines) {
    cover.drawText(line, {
      x: MARGIN,
      y: cursorY,
      size: titleSize,
      font: titleFont,
      color: TITLE_COLOR,
    });
    cursorY -= titleSize + 4;
  }
  // Subtitle
  cursorY -= 8;
  const subLines = wrap(opts.spec.subtitle, italicFont, 14, PAGE_W - MARGIN * 2);
  for (const line of subLines) {
    cover.drawText(line, {
      x: MARGIN,
      y: cursorY,
      size: 14,
      font: italicFont,
      color: SUBTITLE_COLOR,
    });
    cursorY -= 18;
  }
  // Byline
  cover.drawText(opts.spec.author_byline, {
    x: MARGIN,
    y: MARGIN,
    size: 11,
    font: bodyFont,
    color: MUTED,
  });

  // ----- Chapters -----
  for (let i = 0; i < opts.spec.chapters.length; i++) {
    const ch = opts.spec.chapters[i]!;
    opts.onStatus?.(`rendering chapter ${i + 1}/${opts.spec.chapters.length}`);

    // Illustration page
    const chBytes = await imagenPng(client, ch.imagePrompt);
    const chImg = await pdf.embedPng(chBytes);
    const illust = pdf.addPage([PAGE_W, PAGE_H]);
    drawBg(illust);
    const ciW = PAGE_W - MARGIN * 2;
    const ciH = ciW;
    illust.drawImage(chImg, {
      x: MARGIN,
      y: (PAGE_H - ciH) / 2 + 30,
      width: ciW,
      height: ciH,
    });
    illust.drawText(`Chapter ${String(i + 1).padStart(2, "0")}`, {
      x: MARGIN,
      y: (PAGE_H - ciH) / 2 - 30,
      size: 11,
      font: titleFont,
      color: ACCENT,
    });
    illust.drawText(ch.title, {
      x: MARGIN,
      y: (PAGE_H - ciH) / 2 - 60,
      size: 22,
      font: titleFont,
      color: TITLE_COLOR,
    });

    // Prose page
    const proseLines = wrap(ch.prose, bodyFont, 13, PAGE_W - MARGIN * 2);
    const prose = pdf.addPage([PAGE_W, PAGE_H]);
    drawBg(prose);
    prose.drawText(`Chapter ${String(i + 1).padStart(2, "0")}`, {
      x: MARGIN,
      y: PAGE_H - MARGIN,
      size: 11,
      font: titleFont,
      color: ACCENT,
    });
    prose.drawText(ch.title, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 30,
      size: 22,
      font: titleFont,
      color: TITLE_COLOR,
    });
    prose.drawRectangle({
      x: MARGIN,
      y: PAGE_H - MARGIN - 50,
      width: 40,
      height: 2,
      color: ACCENT,
    });

    let py = PAGE_H - MARGIN - 88;
    for (const line of proseLines) {
      if (py < MARGIN) break;
      prose.drawText(line, {
        x: MARGIN,
        y: py,
        size: 13,
        font: bodyFont,
        color: BODY,
      });
      py -= 20;
    }
  }

  const buf = await pdf.save();
  await writeFile(opts.destPath, buf);
}
