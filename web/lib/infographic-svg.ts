/**
 * Render an InfographicSpec to a clean SVG. The SVG is editable and small
 * (~3-5kb) — a fallback / companion to the Imagen-rendered PNG. Layout is
 * automatic per the spec's `layout` field.
 */

import type { InfographicSpec } from "./infographic-writer";

const W = 1280;
const H = 1280;
const BG = "#0B0F1E";
const TITLE = "#FFFFFF";
const SUBTITLE = "#8B8BFF";
const ACCENT = "#3DDAE0";
const BODY = "#E7ECF6";
const MUTED = "#7C87A3";
const PANEL = "#13192E";
const BORDER = "#252C46";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderInfographicSvg(spec: InfographicSpec): string {
  const points = spec.points.slice(0, 6);
  const cols = points.length <= 4 ? 2 : 3;
  const rows = Math.ceil(points.length / cols);

  const padX = 80;
  const headerH = 220;
  const footerH = 60;
  const gridY = headerH + 30;
  const gridH = H - gridY - footerH;
  const cellW = (W - padX * 2 - (cols - 1) * 24) / cols;
  const cellH = (gridH - (rows - 1) * 24) / rows;

  const cells = points
    .map((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cellW + 24);
      const y = gridY + row * (cellH + 24);
      return `
  <g>
    <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="14" fill="${PANEL}" stroke="${BORDER}" />
    <text x="${x + 28}" y="${y + 64}" fill="${ACCENT}" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="700" letter-spacing="3">${escape(p.heading.toUpperCase())}</text>
    <text x="${x + 28}" y="${y + 130}" fill="${TITLE}" font-family="Inter, Segoe UI, sans-serif" font-size="56" font-weight="800">${escape(p.value)}</text>
    <foreignObject x="${x + 28}" y="${y + 150}" width="${cellW - 56}" height="${cellH - 170}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color:${BODY};font:400 16px Inter,Segoe UI,sans-serif;line-height:1.5;">${escape(p.detail)}</div>
    </foreignObject>
  </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0C1226"/>
      <stop offset="1" stop-color="#050614"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <rect x="${padX}" y="80" width="60" height="4" fill="${ACCENT}" />
  <text x="${padX}" y="140" fill="${TITLE}" font-family="Inter, Segoe UI, sans-serif" font-size="48" font-weight="800">${escape(spec.title)}</text>
  <text x="${padX}" y="180" fill="${SUBTITLE}" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="500">${escape(spec.subtitle)}</text>
  ${cells}
  <text x="${padX}" y="${H - 22}" fill="${MUTED}" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="2">TEKAIDA · ${escape(spec.layout.toUpperCase())}</text>
</svg>`;
}
