import { describe, expect, it } from 'vitest';
import { alignBlocks, similarity, type Block, type StableBlock } from '../src/main/anchors/align';
import { pickAnchor, resolve } from '../src/main/anchors/annotations';

let counter = 0;
const ids = () => `b${++counter}`;
const par = (text: string, y: number, page = 1): Block => ({ page, kind: 'par', x: 60, y, text });

describe('alignBlocks', () => {
  const before = alignBlocks([], [par('Intro', 60), par('Waves add linearly.', 100), par('Nodes alternate.', 140)], ids);

  it('keeps ids when blocks shift down after an insertion', () => {
    const after = alignBlocks(before, [par('A new first paragraph.', 60), par('Intro', 100), par('Waves add linearly.', 140), par('Nodes alternate.', 180)], ids);
    expect(after.slice(1).map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(before.map((b) => b.id)).not.toContain(after[0].id);
  });

  it('follows a paragraph whose text was edited', () => {
    const after = alignBlocks(before, [par('Intro', 60), par('Waves add up linearly!', 100), par('Nodes alternate.', 140)], ids);
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
  });

  it('gives a rewritten paragraph a new id', () => {
    const after = alignBlocks(before, [par('Intro', 60), par('Something completely different here', 100), par('Nodes alternate.', 140)], ids);
    expect(after[1].id).not.toBe(before[1].id);
    expect([after[0].id, after[2].id]).toEqual([before[0].id, before[2].id]);
  });

  it('never matches blocks of different kinds', () => {
    const after = alignBlocks(before, [{ ...par('Intro', 60), kind: 'heading' }], ids);
    expect(after[0].id).not.toBe(before[0].id);
  });

  it('scores similarity sensibly', () => {
    expect(similarity('Nodes alternate.', 'Nodes alternate.')).toBe(1);
    expect(similarity('Nodes alternate.', 'Nodes alternate!')).toBeGreaterThan(0.8);
    expect(similarity('Nodes alternate.', 'Quantum chromodynamics')).toBeLessThan(0.2);
  });
});

describe('annotation anchoring', () => {
  const blocks: StableBlock[] = [
    { id: 'h', page: 1, kind: 'heading', x: 60, y: 57, text: 'Title' },
    { id: 'p1', page: 1, kind: 'par', x: 60, y: 95, text: 'First' },
    { id: 'p2', page: 1, kind: 'par', x: 60, y: 153, text: 'Second' },
  ];
  const cluster = { id: 'c1', anchor: { type: 'block' as const, blockId: 'p2', dx: 200, dy: -4 }, w: 80, h: 30, rev: 1 };

  it('picks the block whose top is just above the ink', () => {
    expect(pickAnchor(blocks, 1, 160)?.id).toBe('p2');
    expect(pickAnchor(blocks, 1, 120)?.id).toBe('p1');
    expect(pickAnchor(blocks, 1, 10)?.id).toBe('h'); // above everything: first block on the page
    expect(pickAnchor(blocks, 2, 100)).toBeNull();
  });

  it('moves ink with its block', () => {
    const moved = blocks.map((b) => (b.id === 'p2' ? { ...b, y: 230, page: 1 } : b));
    const { placed, changed } = resolve([cluster], moved, blocks);
    expect(changed).toBe(false);
    expect(placed[0]).toMatchObject({ page: 1, x: 260, y: 226 });
  });

  it('re-anchors to the previous block when its block is deleted, keeping its place', () => {
    const now = blocks.filter((b) => b.id !== 'p2');
    const { placed, clusters, changed } = resolve([cluster], now, blocks);
    expect(changed).toBe(true);
    expect(clusters[0].anchor).toMatchObject({ type: 'block', blockId: 'p1' });
    expect(placed[0]).toMatchObject({ x: 260, y: 149 });
  });

  it('falls back to a fixed page position when nothing survives', () => {
    const { placed, clusters } = resolve([{ ...cluster, anchor: { ...cluster.anchor, blockId: 'h' } }], [], blocks);
    expect(clusters[0].anchor.type).toBe('page');
    expect(placed[0]).toMatchObject({ page: 1, x: 260, y: 53 });
  });
});

describe('saving handwriting', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Library } = await import('../src/main/store/library');
  const { Annotations } = await import('../src/main/anchors/annotations');
  const { DEFAULT_SETTINGS, withHeader } = await import('../src/shared/header');

  const block = (kind: string, y: number, text: string) => ({ page: 1, kind, x: 60, y, text, src: null });
  const layout = (shift = 0) => [block('heading', 57, 'Title'), block('par', 95 + shift, 'First'), block('par', 153 + shift, 'Second')];
  const put = (page: number, bbox: [number, number, number, number]) => ({
    t: 'annotatePut' as const,
    note: 'Waves.typ',
    viewedRev: 1,
    pages: [page],
    clusters: [{ id: 'c1', page, bbox, render: [], pk: [0, 0] as [number, number] }],
  });

  it('keeps existing ink on its text when the Mac lost the layout the iPad drew on', async () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'typink-ann-')), 'Typink');
    const lib = new Library(root);
    lib.ensure();
    const text = withHeader('= Title\n', { ...DEFAULT_SETTINGS, id: 'n1' });
    const ann = new Annotations(() => lib, () => text);

    await ann.save(put(1, [260, 150, 80, 30]), new Uint8Array(), { blocks: layout() });
    expect(ann.place('Waves.typ', layout(40))?.placed[0]).toMatchObject({ page: 1, x: 260, y: 190 });

    // Ink on another page, sent again after the Mac restarted: no snapshot for its viewedRev.
    await ann.save(put(2, [100, 100, 50, 20]), new Uint8Array(), null);
    const placed = ann.place('Waves.typ', layout(80))!.placed;
    expect(placed.find((p) => p.page === 1)).toMatchObject({ x: 260, y: 230 }); // still follows "Second"
    expect(placed.find((p) => p.page === 2)).toMatchObject({ x: 100, y: 100 });
  });
});
