import { describe, expect, it } from 'vitest';
import { strokeOutline } from '../src/main/ink/outline';
import { imageSize, renderStrokesSvg } from '../src/main/ink/svg';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('strokeOutline', () => {
  it('draws a single sample as a dot', () => {
    expect(strokeOutline([[10, 10, 4]])).toMatch(/^M8 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z$/);
  });

  it('produces a closed, finite outline that surrounds the stroke', () => {
    const d = strokeOutline([
      [0, 0, 2],
      [10, 0, 4],
      [20, 5, 2],
    ]);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const n = numbers(d);
    expect(n.every(Number.isFinite)).toBe(true);
    const xs = n.filter((_, i) => i % 2 === 0);
    const ys = n.filter((_, i) => i % 2 === 1);
    // Round caps extend past both ends; widths extend above and below.
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(20);
    expect(Math.min(...ys)).toBeLessThan(-1);
  });

  it('survives duplicate points and hairpin turns', () => {
    const d = strokeOutline([
      [5, 5, 2],
      [5, 5, 2],
      [15, 5, 2],
      [5, 5, 2],
    ]);
    expect(numbers(d).every(Number.isFinite)).toBe(true);
  });
});

describe('renderStrokesSvg', () => {
  const stroke = { ink: 'marker' as const, color: '#ffcc00ff', colorDark: '#806600ff', points: [0, 0, 8, 1, 30, 0, 8, 1] };

  it('uses the dark colour on dark paper and makes markers translucent', () => {
    const light = renderStrokesSvg({ w: 100, h: 50 }, [stroke], false);
    const dark = renderStrokesSvg({ w: 100, h: 50 }, [stroke], true);
    expect(light).toContain('fill="#ffcc00"');
    expect(dark).toContain('fill="#806600"');
    expect(light).toContain('fill-opacity="0.450"');
    expect(light).toContain('width="100pt" height="50pt" viewBox="0 0 100 50"');
  });

  it('skips empty strokes', () => {
    expect(renderStrokesSvg({ w: 10, h: 10 }, [{ ...stroke, points: [] }], false)).not.toContain('<path');
  });
});

describe('imageSize', () => {
  it('reads PNG and SVG dimensions', () => {
    const png = new Uint8Array(32);
    const view = new DataView(png.buffer);
    view.setUint32(0, 0x89504e47);
    view.setUint32(16, 640);
    view.setUint32(20, 480);
    expect(imageSize(png)).toEqual({ w: 640, h: 480 });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>');
    expect(imageSize(svg)).toEqual({ w: 120, h: 80 });
  });
});

describe('collectUnusedInk', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Library } = await import('../src/main/store/library');

  it('trashes old sketches that no note uses and keeps the rest', () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'typink-gc-')), 'Typink');
    const lib = new Library(root);
    lib.ensure(); // creates the welcome note, which uses the "welcome" sketch
    const old = Date.now() - 40 * 86_400_000;
    lib.updateManifest((m) => {
      m.ink.unused = { w: 10, h: 10, n: 1, rev: 1, created: old };
      m.ink.recent = { w: 10, h: 10, n: 1, rev: 1, created: Date.now() };
      m.ink.welcome.created = old;
    });
    fs.writeFileSync(lib.inkPath('unused.svg'), '<svg/>');
    expect(lib.collectUnusedInk()).toBe(1);
    expect(Object.keys(lib.readManifest().ink).sort()).toEqual(['recent', 'welcome']);
    expect(fs.existsSync(path.join(root, '.typink', 'trash', 'ink-unused.svg'))).toBe(true);
  });
});
