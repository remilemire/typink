// Reads and writes sketch files in <root>/.typink/ink:
//   <id>.pkdrawing   PencilKit's own data (source of truth for editing on the iPad)
//   <id>.json        canvas size + vector render data
//   <id>.svg/.dark.svg  what Typst embeds

import fs from 'node:fs';
import type { RenderStroke } from '@typink/protocol';
import { type Library, writeFileAtomic } from '../store/library';
import { renderStrokesSvg } from './svg';

export interface SavedSketch {
  rev: number;
  n: number;
}

export function saveSketch(
  library: Library,
  id: string,
  sketch: { size: { w: number; h: number }; render: RenderStroke[]; pk: Uint8Array | null },
): SavedSketch {
  const { size, render, pk } = sketch;
  if (pk) writeFileAtomic(library.inkPath(`${id}.pkdrawing`), pk);
  writeFileAtomic(library.inkPath(`${id}.json`), JSON.stringify({ v: 1, size, render }));
  writeFileAtomic(library.inkPath(`${id}.svg`), renderStrokesSvg(size, render, false));
  writeFileAtomic(library.inkPath(`${id}.dark.svg`), renderStrokesSvg(size, render, true));
  let saved: SavedSketch = { rev: 1, n: render.length };
  library.updateManifest((m) => {
    const prev = m.ink[id];
    saved = { rev: (prev?.rev ?? 0) + 1, n: render.length };
    m.ink[id] = { w: size.w, h: size.h, n: render.length, rev: saved.rev, created: prev?.created ?? Date.now() };
  });
  return saved;
}

export function readPencilKitData(library: Library, id: string): Uint8Array | null {
  try {
    return new Uint8Array(fs.readFileSync(library.inkPath(`${id}.pkdrawing`)));
  } catch {
    return null;
  }
}

/** Re-sizes an empty sketch (e.g. to the width it actually got on the page). */
export function resizeSketch(library: Library, id: string, w: number, h: number): void {
  library.updateManifest((m) => {
    const entry = m.ink[id];
    if (entry) m.ink[id] = { ...entry, w, h };
  });
  const svg = renderStrokesSvg({ w, h }, [], false);
  writeFileAtomic(library.inkPath(`${id}.svg`), svg);
  writeFileAtomic(library.inkPath(`${id}.dark.svg`), svg);
}
