// Splits typst.ts' `svg()` output into pages.
//
// The document SVG looks like
//   <svg class="typst-doc" …><style/><defs class="glyph">…</defs><defs class="clip-path">…</defs><style/>
//     <g class="typst-page" transform="translate(0, y)" data-tid="…" data-page-width="w" data-page-height="h">…</g>
//     …
//   </svg>
// Glyphs are shared <path id> defs referenced with <use>, so pages rendered inline in
// the same HTML document can share one hidden <defs> block.

export interface SvgPage {
  /** Content hash of the page; unchanged pages keep the same tid across compiles. */
  tid: string;
  width: number;
  height: number;
  /** Inner markup of the page group (no wrapper, no translate). */
  body: string;
}

export interface SplitSvg {
  /** All <defs> blocks, concatenated. */
  defs: string;
  pages: SvgPage[];
}

const PAGE_OPEN = /<g class="typst-page"[^>]*>/g;

export function splitTypstSvg(svg: string): SplitSvg {
  const opens = [...svg.matchAll(PAGE_OPEN)];
  const end = svg.lastIndexOf('</svg>');
  const headerEnd = svg.indexOf('>') + 1;
  const preamble = svg.slice(headerEnd, opens[0]?.index ?? end);
  const defs = [...preamble.matchAll(/<defs[\s\S]*?<\/defs>/g)].map((m) => m[0]).join('');

  // data-page-width/height are rounded up to whole points; the document viewBox
  // and the pages' translate offsets carry the exact sizes.
  const viewBox = svg.slice(0, headerEnd).match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
  const docWidth = viewBox ? parseFloat(viewBox[1]) : NaN;
  const docHeight = viewBox ? parseFloat(viewBox[2]) : NaN;
  const offsets = opens.map((m) => parseFloat(m[0].match(/translate\([\d.\-]+,\s*([\d.\-]+)\)/)?.[1] ?? 'NaN'));

  const pages = opens.map((m, i) => {
    const start = m.index!;
    const next = i + 1 < opens.length ? opens[i + 1].index! : end;
    const chunk = svg.slice(start, next);
    const tag = m[0];
    // Drop the wrapper: the opening tag and the matching closing </g> at the end of the chunk.
    const body = chunk.slice(tag.length, chunk.lastIndexOf('</g>'));
    const roundedWidth = parseFloat(attr(tag, 'data-page-width') ?? '0');
    const roundedHeight = parseFloat(attr(tag, 'data-page-height') ?? '0');
    const nextOffset = i + 1 < offsets.length ? offsets[i + 1] : docHeight;
    const exactHeight = nextOffset - offsets[i];
    return {
      tid: attr(tag, 'data-tid') ?? String(i),
      width: Math.abs(docWidth - roundedWidth) < 1 ? docWidth : roundedWidth,
      height: Math.abs(exactHeight - roundedHeight) < 1 ? exactHeight : roundedHeight,
      body,
    };
  });
  return { defs, pages };
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/** Removes the invisible HTML text layer typst.ts adds for text selection. */
export function stripTextLayer(markup: string): string {
  return markup.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '');
}

/**
 * A self-contained SVG document for one page (for <img>/canvas rasterization).
 * `size` crops to the exact page size when known (typst.ts rounds up to whole points).
 */
export function standalonePage(split: SplitSvg, index: number, size?: { w: number; h: number }): string {
  const page = split.pages[index];
  const w = size?.w ?? page.width;
  const h = size?.h ?? page.height;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none">` +
    `${stripTextLayer(split.defs)}<g>${stripTextLayer(page.body)}</g></svg>`
  );
}
