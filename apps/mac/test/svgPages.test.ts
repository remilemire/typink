import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';
import { describe, expect, it } from 'vitest';
import { pageSizes } from '../src/main/compile/service';
import { splitTypstSvg, standalonePage } from '../src/shared/svgPages';

// One long-lived compiler, like the app's engine (glyph ids, and so page hashes,
// are only stable within a compiler instance).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typink-svg-'));
const compiler = NodeCompiler.create({ workspace: root });

function compileSvg(source: string): string {
  fs.writeFileSync(path.join(root, 'main.typ'), source);
  const result = compiler.compile({ mainFilePath: path.join(root, 'main.typ') });
  return compiler.svg(result.result!);
}

describe('splitTypstSvg on real typst.ts output', () => {
  const svg = compileSvg('#set page(width: 200pt, height: 120pt, fill: white)\n= One\nHello\n#pagebreak()\n= Two\n#pagebreak()\n= Three\n');
  const split = splitTypstSvg(svg);

  it('finds every page with its size and content hash', () => {
    expect(split.pages).toHaveLength(3);
    for (const p of split.pages) {
      expect(p.width).toBe(200);
      expect(p.height).toBe(120);
      expect(p.tid).toMatch(/^p/);
    }
    expect(new Set(split.pages.map((p) => p.tid)).size).toBe(3);
    expect(pageSizes(svg)).toEqual(split.pages.map((p) => ({ w: 200, h: 120 })));
  });

  it('keeps shared glyph definitions separately', () => {
    expect(split.defs).toContain('<defs');
    expect(split.pages[0].body).toContain('<use');
    expect(split.pages[0].body).not.toContain('typst-page');
  });

  it('builds a self-contained page for rasterizing', () => {
    const page = standalonePage(split, 1);
    expect(page.startsWith('<svg')).toBe(true);
    expect(page).toContain('viewBox="0 0 200 120"');
    expect(page).not.toContain('foreignObject');
    expect(page).toContain('<defs');
  });

  it('crops a standalone page to an exact size', () => {
    const page = standalonePage(split, 0, { w: 199.5, h: 119.25 });
    expect(page).toContain('viewBox="0 0 199.5 119.25"');
  });

  // typst.ts page hashes are only a hint: identical pages sometimes get a new
  // hash (the preview then just re-renders that page), but an edited page always does.
  it('gives edited pages a new hash and leaves the other pages unchanged', () => {
    const again = splitTypstSvg(compileSvg('#set page(width: 200pt, height: 120pt, fill: white)\n= One\nHello\n#pagebreak()\n= Two changed\n#pagebreak()\n= Three\n'));
    const strip = (body: string) => body.replace(/ data-tid="[^"]*"/g, '');
    expect(again.pages[1].tid).not.toBe(split.pages[1].tid);
    expect(strip(again.pages[0].body)).toBe(strip(split.pages[0].body));
    expect(strip(again.pages[1].body)).not.toBe(strip(split.pages[1].body));
  });
});
