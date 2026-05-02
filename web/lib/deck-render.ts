/**
 * Render a DeckSpec to a downloadable PPTX file using pptxgenjs.
 *
 * Visual style: deep navy theme matching the Tekaida brand. Cover slide,
 * then content slides with title + bulleted body. Speaker notes embedded
 * if provided so the presenter can read them in PowerPoint's notes pane.
 */

import { writeFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import type { DeckSpec } from "./deck-writer";

const BG_COLOR = "0B0F1E";          // deep navy
const TITLE_COLOR = "FFFFFF";
const SUBTITLE_COLOR = "8B8BFF";    // indigo accent
const BULLET_COLOR = "E7ECF6";
const ACCENT_COLOR = "3DDAE0";      // cyan accent

export async function renderDeckToFile(spec: DeckSpec, destPath: string): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches
  pptx.title = spec.title;

  // ----- Cover slide -----
  const cover = pptx.addSlide();
  cover.background = { color: BG_COLOR };
  cover.addText(spec.title, {
    x: 0.7,
    y: 2.6,
    w: 12,
    h: 1.5,
    fontFace: "Calibri",
    fontSize: 54,
    bold: true,
    color: TITLE_COLOR,
  });
  cover.addText(spec.subtitle, {
    x: 0.7,
    y: 4.2,
    w: 12,
    h: 0.8,
    fontFace: "Calibri",
    fontSize: 22,
    color: SUBTITLE_COLOR,
  });
  cover.addShape("line", {
    x: 0.7,
    y: 4.0,
    w: 1.5,
    h: 0,
    line: { color: ACCENT_COLOR, width: 2 },
  });

  // ----- Content slides -----
  for (let i = 0; i < spec.slides.length; i++) {
    const s = spec.slides[i]!;
    const slide = pptx.addSlide();
    slide.background = { color: BG_COLOR };

    // Slide number tab
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: 0.7,
      y: 0.45,
      w: 0.8,
      h: 0.4,
      fontFace: "Calibri",
      fontSize: 14,
      bold: true,
      color: ACCENT_COLOR,
    });

    // Title
    slide.addText(s.title, {
      x: 0.7,
      y: 0.95,
      w: 11.9,
      h: 1,
      fontFace: "Calibri",
      fontSize: 32,
      bold: true,
      color: TITLE_COLOR,
    });

    // Underline
    slide.addShape("line", {
      x: 0.7,
      y: 1.95,
      w: 0.9,
      h: 0,
      line: { color: ACCENT_COLOR, width: 2 },
    });

    // Bullets
    if (s.bullets && s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({
          text: b,
          options: { bullet: { code: "25CF" }, color: BULLET_COLOR, fontSize: 18 },
        })),
        {
          x: 0.9,
          y: 2.4,
          w: 11.5,
          h: 4.3,
          fontFace: "Calibri",
          fontSize: 18,
          color: BULLET_COLOR,
          paraSpaceAfter: 8,
          valign: "top",
        },
      );
    }

    if (s.speaker_notes) {
      slide.addNotes(s.speaker_notes);
    }
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  await writeFile(destPath, buffer);
}
