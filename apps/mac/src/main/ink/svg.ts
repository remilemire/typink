// SVG files for sketches, plus image-size sniffing for draw-on-image sketches.

import type { RenderStroke } from '@typink/protocol';
import { type Sample, strokeOutline } from './outline';

export function emptySketchSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}"></svg>`;
}

/** How translucent each ink looks (PencilKit's marker is see-through). */
const INK_ALPHA: Record<RenderStroke['ink'], number> = {
  pen: 1,
  monoline: 1,
  fountainPen: 1,
  pencil: 0.9,
  marker: 0.45,
  other: 1,
};

function parseColour(hex: string): { rgb: string; alpha: number } {
  return { rgb: `#${hex.slice(1, 7)}`, alpha: parseInt(hex.slice(7, 9), 16) / 255 };
}

/** Renders strokes as filled outlines in an SVG sized in pt (1 unit = 1 pt). */
export function renderStrokesSvg(size: { w: number; h: number }, strokes: RenderStroke[], dark: boolean): string {
  const paths: string[] = [];
  for (const stroke of strokes) {
    const samples: Sample[] = [];
    let opacity = 0;
    for (let i = 0; i + 3 < stroke.points.length; i += 4) {
      samples.push([stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]]);
      opacity += stroke.points[i + 3];
    }
    if (samples.length === 0) continue;
    const d = strokeOutline(samples);
    if (!d) continue;
    const { rgb, alpha } = parseColour(dark ? stroke.colorDark : stroke.color);
    const a = Math.min(1, alpha * INK_ALPHA[stroke.ink] * (opacity / samples.length || 1));
    paths.push(`<path d="${d}" fill="${rgb}"${a < 0.999 ? ` fill-opacity="${a.toFixed(3)}"` : ''}/>`);
  }
  const w = Math.round(size.w * 100) / 100;
  const h = Math.round(size.h * 100) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}">${paths.join('')}</svg>`;
}

/** Pixel (or point, for SVG/PDF) dimensions of an image, or null if the format is unknown. */
export function imageSize(data: Uint8Array): { w: number; h: number } | null {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // PNG: IHDR width/height at 16..24
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  // GIF
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  // JPEG: walk the segments until a start-of-frame marker
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      const length = b.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + length;
    }
    return null;
  }
  // WebP
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  const head = b.toString('latin1', 0, Math.min(b.length, 4096));
  // SVG: width/height attributes, else the viewBox
  if (/<svg[\s>]/.test(head)) {
    const tag = head.slice(head.indexOf('<svg'));
    const attr = (name: string) => tag.match(new RegExp(`\\s${name}="([\\d.]+)`))?.[1];
    const w = parseFloat(attr('width') ?? ''), h = parseFloat(attr('height') ?? '');
    if (w > 0 && h > 0) return { w, h };
    const vb = tag.match(/viewBox="[\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/);
    if (vb) return { w: parseFloat(vb[1]), h: parseFloat(vb[2]) };
  }
  // PDF: first MediaBox in the file
  if (head.startsWith('%PDF')) {
    const m = b.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/);
    if (m) return { w: parseFloat(m[3]) - parseFloat(m[1]), h: parseFloat(m[4]) - parseFloat(m[2]) };
  }
  return null;
}
