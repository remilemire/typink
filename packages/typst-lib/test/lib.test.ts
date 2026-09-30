import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const libPath = path.join(here, '..', 'lib.typ');
const sample = fs.readFileSync(path.join(here, '..', 'fixtures', 'sample.typ'), 'utf8');

// Run the whole suite against the pinned engine (Typst 0.14) and the next one (Typst 0.15).
const engines = [
  ['typst 0.14 (typst.ts 0.7.0)', '@myriaddreamin/typst-ts-node-compiler'],
  ['typst 0.15 (typst.ts 0.8.0-rc3)', 'typst-ts-next'],
] as const;

type Block = { k: string; x: number; y: number; t: string; src: string | null };
type Layout = { pitch: number; ruled: boolean; 'origin-y': number; template: string };

let root: string;

const sketchSvg = (colour: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="480pt" height="144pt" viewBox="0 0 480 144">` +
  `<path d="M20 100 C 80 20, 160 20, 220 100" fill="none" stroke="${colour}" stroke-width="3"/></svg>`;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'typink-lib-'));
  fs.mkdirSync(path.join(root, '.typink', 'ink'), { recursive: true });
  fs.mkdirSync(path.join(root, '.typink', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Notes'), { recursive: true });
  fs.copyFileSync(libPath, path.join(root, '.typink', 'lib.typ'));
  fs.writeFileSync(path.join(root, '.typink', 'ink', 'sk1.svg'), sketchSvg('#1d4ed8'));
  fs.writeFileSync(path.join(root, '.typink', 'ink', 'sk1.dark.svg'), sketchSvg('#93c5fd'));
  fs.writeFileSync(
    path.join(root, '.typink', 'manifest.json'),
    JSON.stringify({ v: 1, ink: { sk1: { w: 480, h: 144, n: 1 }, sk2: { w: 480, h: 96, n: 0 } } }),
  );
  fs.writeFileSync(path.join(root, '.typink', 'ann', 'c1.svg'), sketchSvg('#dc2626'));
  fs.writeFileSync(
    path.join(root, '.typink', 'ann', 'n1.place.json'),
    JSON.stringify({ items: [{ page: 1, x: 300, y: 100, w: 120, h: 36, file: '/.typink/ann/c1.svg' }] }),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function writeNote(name: string, header: string, body: string) {
  const file = path.join(root, 'Notes', `${name}.typ`);
  fs.writeFileSync(file, `#import "/.typink/lib.typ": *\n#show: note.with(${header})\n${body}`);
  return file;
}

function compile(pkg: string, file: string, inputs: Record<string, string> = {}) {
  const { NodeCompiler } = require(pkg);
  const compiler = NodeCompiler.create({ workspace: root });
  const result = compiler.compile({ mainFilePath: file, inputs: { theme: 'light', ...inputs } });
  if (result.hasError()) {
    const diagnostics = compiler.fetchDiagnostics(result.takeDiagnostics());
    throw new Error(diagnostics.map((d: { message: string }) => d.message).join('\n'));
  }
  const doc = result.result;
  const query = (selector: string) =>
    compiler.query(doc, { selector }).map((m: { value: unknown }) => m.value);
  return { compiler, doc, query };
}

function offGrid(blocks: Block[], layout: Layout) {
  const top = layout['origin-y'] - 0.72 * layout.pitch;
  return blocks.filter((b) => {
    const r = (((b.y - top) % layout.pitch) + layout.pitch) % layout.pitch;
    return Math.min(r, layout.pitch - r) > 0.05;
  });
}

describe.each(engines)('%s', (_label, pkg) => {
  const papers = ['a4', 'us-letter', 'endless'];
  const templates = ['blank', 'lined', 'grid', 'dotted'];
  const fonts = ['serif', 'sans', 'modern', 'mono'];

  it.each(templates.flatMap((t) => papers.map((p) => [t, p])))(
    'template %s on %s compiles and keeps every block on the ruling',
    (template, paper) => {
      for (const font of fonts) {
        for (const theme of ['light', 'dark']) {
          const file = writeNote(
            `${template}-${paper}-${font}`,
            `id: "n1", paper: "${paper}", template: "${template}", font: "${font}"`,
            sample,
          );
          const { doc, query } = compile(pkg, file, { theme, preview: '1' });
          expect(doc.numOfPages).toBeGreaterThan(0);
          const [layout] = query('<__layout>') as Layout[];
          expect(layout.template).toBe(template);
          const blocks = (query('<__blocks>') as Block[][]).flat();
          expect(blocks.length).toBeGreaterThan(10);
          if (layout.ruled) expect(offGrid(blocks, layout)).toEqual([]);
        }
      }
    },
  );

  it('reports sketch positions and sizes', () => {
    const file = writeNote('sketches', 'id: "n1", template: "lined"', 'Intro\n\n#sketch("sk1")\n\n#sketch("sk2", width: 50%)\n');
    const { query } = compile(pkg, file);
    const sketches = query('<__sketch>') as { id: string; page: number; w: number; h: number }[];
    expect(sketches.map((s) => s.id)).toEqual(['sk1', 'sk2']);
    const [full, half] = sketches;
    expect(full.page).toBe(1);
    expect(full.h / full.w).toBeCloseTo(144 / 480, 5);
    expect(half.w).toBeCloseTo(full.w / 2, 1);
  });

  it('tolerates sketches that are not in the manifest', () => {
    const file = writeNote('missing', 'id: "n1"', 'Before\n\n#sketch("nope")\n\nAfter\n');
    expect(() => compile(pkg, file)).not.toThrow();
    expect(() => compile(pkg, file, { preview: '1' })).not.toThrow();
  });

  it('bakes annotations into the page only when asked', () => {
    const file = writeNote('ann', 'id: "n1", template: "lined"', 'Some text to annotate.\n');
    const plain = compile(pkg, file);
    const baked = compile(pkg, file, { ann: 'on' });
    const count = (svg: string) => (svg.match(/<image /g) ?? []).length;
    expect(count(baked.compiler.svg(baked.doc))).toBe(count(plain.compiler.svg(plain.doc)) + 1);
  });

  it('extracts readable text for block anchors', () => {
    const file = writeNote('anchors', 'id: "n1"', '= Title\n\nA *bold* move.\n\n- one\n- two\n');
    const { query } = compile(pkg, file);
    const blocks = (query('<__blocks>') as Block[][]).flat();
    expect(blocks.map((b) => [b.k, b.t])).toEqual([
      ['heading', 'Title'],
      ['par', 'A bold move.'],
      ['list', 'onetwo'],
    ]);
  });
});
