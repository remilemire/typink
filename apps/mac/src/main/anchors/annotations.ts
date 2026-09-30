// Freeform handwriting over typed text.
//
// The iPad sends ink as clusters (strokes that belong together) in page
// coordinates. Each cluster is anchored to the block (paragraph, heading, …)
// it was drawn on, as an offset from that block's top-left corner. After every
// compile, blocks are re-identified with alignBlocks(), so the ink moves with
// its paragraph when text above it is added or removed. When a block is
// deleted, its ink re-anchors to the previous surviving block and stays where it
// was on the page; nothing is dropped.
//
// Files (per note id, from the note header):
//   .typink/ann/<noteId>.json               anchors, sizes, and the last known block list
//   .typink/ann/<noteId>/<cluster>.pkdrawing   PencilKit data (for editing on the iPad)
//   .typink/ann/<noteId>/<cluster>(.dark).svg  what the Mac preview and exports draw
//   .typink/ann/<noteId>.place.json          absolute placements, written for exports

import fs from 'node:fs';
import path from 'node:path';
import { type FromPad, part } from '@typink/protocol';
import { newId, parseHeader } from '@shared/header';
import type { AnnotationOverlay, BlockAnchor } from '@shared/types';
import { renderStrokesSvg } from '../ink/svg';
import { type Library, writeFileAtomic } from '../store/library';
import { alignBlocks, type StableBlock } from './align';

type Anchor =
  | { type: 'block'; blockId: string; dx: number; dy: number }
  | { type: 'page'; page: number; x: number; y: number };

interface Cluster {
  id: string;
  anchor: Anchor;
  w: number;
  h: number;
  rev: number;
}

interface AnnotationFile {
  v: 1;
  blocks: StableBlock[];
  clusters: Cluster[];
}

export interface Placed {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rev: number;
}

export interface Snapshot {
  blocks: BlockAnchor[];
}

const FLUSH_MS = 2000;

export class Annotations {
  private cache = new Map<string, AnnotationFile>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly library: () => Library,
    private readonly noteText: (notePath: string) => string,
  ) {}

  /** Note id from the header, or null for plain Typst files. */
  noteId(notePath: string): string | null {
    try {
      return parseHeader(this.noteText(notePath))?.settings.id || null;
    } catch {
      return null;
    }
  }

  hasAnnotations(notePath: string): boolean {
    const id = this.noteId(notePath);
    return !!id && this.load(id).clusters.length > 0;
  }

  /** Re-identifies blocks after a compile and returns where every cluster sits now. */
  place(notePath: string, blocks: BlockAnchor[]): { noteId: string; placed: Placed[] } | null {
    const noteId = this.noteId(notePath);
    if (!noteId) return null;
    const data = this.load(noteId);
    if (data.clusters.length === 0) return { noteId, placed: [] };
    const aligned = alignBlocks(data.blocks, blocks);
    const { placed, clusters, changed } = resolve(data.clusters, aligned, data.blocks);
    const blocksChanged =
      aligned.length !== data.blocks.length || aligned.some((b, i) => b.id !== data.blocks[i].id || b.y !== data.blocks[i].y);
    if (changed || blocksChanged) {
      data.blocks = aligned;
      data.clusters = clusters;
      this.markDirty(noteId);
    }
    return { noteId, placed };
  }

  overlays(notePath: string, blocks: BlockAnchor[]): AnnotationOverlay[] {
    const res = this.place(notePath, blocks);
    if (!res) return [];
    return res.placed.map((p) => ({
      id: p.id,
      page: p.page,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      url: `typink://ann/${res.noteId}/${p.id}.svg?rev=${p.rev}`,
      urlDark: `typink://ann/${res.noteId}/${p.id}.dark.svg?rev=${p.rev}`,
    }));
  }

  /** Clusters with their PencilKit data, positioned for the iPad. */
  forPad(notePath: string, blocks: BlockAnchor[]): (Placed & { pk: Uint8Array })[] | null {
    const res = this.place(notePath, blocks);
    if (!res) return null;
    const out: (Placed & { pk: Uint8Array })[] = [];
    for (const p of res.placed) {
      try {
        out.push({ ...p, pk: new Uint8Array(fs.readFileSync(this.clusterPath(res.noteId, `${p.id}.pkdrawing`))) });
      } catch {
        // PencilKit data missing: the Mac still draws the SVG, the iPad just can't edit it.
      }
    }
    return out;
  }

  /** Replaces the ink on the pages the iPad edited. */
  async save(msg: Extract<FromPad, { t: 'annotatePut' }>, payload: Uint8Array, snapshot: Snapshot | null): Promise<void> {
    const noteId = this.noteId(msg.note);
    if (!noteId) throw new Error('Handwriting needs a Typink note. Click “Make it a Typink note” on the Mac first.');
    const data = this.load(noteId);
    // Without the layout the iPad drew on, the last known one is the best guess. Never an empty
    // one: that would cut every existing cluster loose from its text.
    const layout = snapshot ? alignBlocks(data.blocks, snapshot.blocks) : data.blocks;
    const { placed, clusters } = resolve(data.clusters, layout, data.blocks);
    const pageOf = new Map(placed.map((p) => [p.id, p.page]));
    const edited = new Set(msg.pages);

    const kept: Cluster[] = [];
    for (const c of clusters) {
      if (edited.has(pageOf.get(c.id) ?? -1)) this.removeClusterFiles(noteId, c.id);
      else kept.push(c);
    }

    for (const c of msg.clusters) {
      const [bx, by, bw, bh] = c.bbox;
      const w = Math.max(1, bw);
      const h = Math.max(1, bh);
      // The ink's vertical centre picks the block: a circle or underline centres on the words it marks.
      const block = pickAnchor(layout, c.page, by + h / 2);
      const anchor: Anchor = block
        ? { type: 'block', blockId: block.id, dx: bx - block.x, dy: by - block.y }
        : { type: 'page', page: c.page, x: bx, y: by };
      const id = newId('c');
      const pk = part(payload, c.pk);
      if (pk) writeFileAtomic(this.clusterPath(noteId, `${id}.pkdrawing`), pk);
      writeFileAtomic(this.clusterPath(noteId, `${id}.svg`), renderStrokesSvg({ w, h }, c.render, false));
      writeFileAtomic(this.clusterPath(noteId, `${id}.dark.svg`), renderStrokesSvg({ w, h }, c.render, true));
      kept.push({ id, anchor, w, h, rev: 1 });
    }

    data.blocks = layout;
    data.clusters = kept;
    this.cache.set(noteId, data);
    this.write(noteId);
  }

  /** Writes absolute placements for lib.typ to bake into an export; false when there is no ink. */
  writePlacements(notePath: string, blocks: BlockAnchor[]): boolean {
    const res = this.place(notePath, blocks);
    if (!res || res.placed.length === 0) return false;
    const base = `/.typink/ann/${res.noteId}`;
    const items = res.placed.map((p) => ({
      page: p.page,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      file: `${base}/${p.id}.svg`,
      fileDark: `${base}/${p.id}.dark.svg`,
    }));
    writeFileAtomic(this.library().annPath(`${res.noteId}.place.json`), JSON.stringify({ items }));
    return true;
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const id of this.dirty) this.write(id);
    this.dirty.clear();
  }

  /** Forget cached state (the library folder changed). */
  reset(): void {
    this.flush();
    this.cache.clear();
  }

  // ---- storage -----------------------------------------------------------------------

  private load(noteId: string): AnnotationFile {
    const cached = this.cache.get(noteId);
    if (cached) return cached;
    let data: AnnotationFile = { v: 1, blocks: [], clusters: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.library().annPath(`${noteId}.json`), 'utf8')) as AnnotationFile;
      data = { v: 1, blocks: raw.blocks ?? [], clusters: raw.clusters ?? [] };
    } catch {
      // no annotations yet
    }
    this.cache.set(noteId, data);
    return data;
  }

  private write(noteId: string): void {
    const data = this.cache.get(noteId);
    if (!data) return;
    this.dirty.delete(noteId);
    writeFileAtomic(this.library().annPath(`${noteId}.json`), JSON.stringify(data));
  }

  private markDirty(noteId: string): void {
    this.dirty.add(noteId);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_MS);
    }
  }

  private clusterPath(noteId: string, file: string): string {
    return path.join(this.library().annPath(noteId), file);
  }

  private removeClusterFiles(noteId: string, id: string): void {
    for (const f of [`${id}.pkdrawing`, `${id}.svg`, `${id}.dark.svg`]) fs.rmSync(this.clusterPath(noteId, f), { force: true });
  }
}

// ---- anchoring ------------------------------------------------------------------------------

/** The block whose top is closest above `y` (the ink's centre) on the page, else the first block on it. */
export function pickAnchor(blocks: StableBlock[], page: number, y: number): StableBlock | null {
  const onPage = blocks.filter((b) => b.page === page).sort((a, b) => a.y - b.y);
  if (onPage.length === 0) return null;
  let best = onPage[0];
  for (const b of onPage) if (b.y <= y + 2) best = b;
  return best;
}

/**
 * Positions clusters against the current blocks. Clusters whose block vanished
 * are re-anchored to the nearest earlier surviving block (from the previous
 * layout), keeping their position on the page.
 */
export function resolve(
  clusters: Cluster[],
  current: StableBlock[],
  previous: StableBlock[],
): { placed: Placed[]; clusters: Cluster[]; changed: boolean } {
  const byId = new Map(current.map((b) => [b.id, b]));
  const prevIndex = new Map(previous.map((b, i) => [b.id, i]));
  const placed: Placed[] = [];
  const out: Cluster[] = [];
  let changed = false;

  for (const c of clusters) {
    let anchor = c.anchor;
    if (anchor.type === 'block' && !byId.has(anchor.blockId)) {
      changed = true;
      const i = prevIndex.get(anchor.blockId);
      const old = i === undefined ? undefined : previous[i];
      anchor = old ? reanchor(anchor, old, previous, i!, byId) : { type: 'page', page: 1, x: anchor.dx, y: anchor.dy };
    }
    if (anchor.type === 'block') {
      const b = byId.get(anchor.blockId)!;
      placed.push({ id: c.id, page: b.page, x: b.x + anchor.dx, y: b.y + anchor.dy, w: c.w, h: c.h, rev: c.rev });
    } else {
      placed.push({ id: c.id, page: anchor.page, x: anchor.x, y: anchor.y, w: c.w, h: c.h, rev: c.rev });
    }
    out.push(anchor === c.anchor ? c : { ...c, anchor });
  }
  return { placed, clusters: out, changed };
}

function reanchor(
  anchor: Extract<Anchor, { type: 'block' }>,
  old: StableBlock,
  previous: StableBlock[],
  index: number,
  byId: Map<string, StableBlock>,
): Anchor {
  const absX = old.x + anchor.dx;
  const absY = old.y + anchor.dy;
  for (let k = index - 1; k >= 0; k--) {
    const candidate = previous[k];
    if (!byId.has(candidate.id)) continue;
    if (candidate.page !== old.page) break;
    return { type: 'block', blockId: candidate.id, dx: absX - candidate.x, dy: absY - candidate.y };
  }
  return { type: 'page', page: old.page, x: absX, y: absY };
}
