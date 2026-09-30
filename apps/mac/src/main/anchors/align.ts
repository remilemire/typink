// Gives the document's blocks (paragraphs, headings, lists, …) stable ids across
// edits, so handwriting anchored to a block follows it when text moves.
//
// 1. Blocks whose kind+text are unchanged are matched with a longest common
//    subsequence, which keeps them in order.
// 2. Between two matched blocks, edited blocks are paired by text similarity.
// 3. Anything left over is new and gets a fresh id.

import { newId } from '@shared/header';

export interface Block {
  page: number;
  kind: string;
  x: number;
  y: number;
  text: string;
}

export interface StableBlock extends Block {
  id: string;
}

const key = (b: Block) => `${b.kind}\u0000${b.text.trim()}`;

export function alignBlocks(prev: StableBlock[], next: Block[], makeId: () => string = () => newId('b', 6)): StableBlock[] {
  const n = prev.length;
  const m = next.length;
  const pk = prev.map(key);
  const nk = next.map(key);

  // LCS table (suffix form) over exact keys.
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = pk[i] === nk[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matchOfNext = new Array<number>(m).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (pk[i] === nk[j]) {
      matchOfNext[j] = i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  // Fill the gaps between exact matches with the most similar edited blocks.
  const usedPrev = new Set(matchOfNext.filter((i) => i >= 0));
  let prevCursor = 0;
  for (let j = 0; j < m; j++) {
    if (matchOfNext[j] >= 0) {
      prevCursor = matchOfNext[j] + 1;
      continue;
    }
    // The gap in `prev` ends at the next exactly-matched block.
    let gapEnd = n;
    for (let k = j + 1; k < m; k++) {
      if (matchOfNext[k] >= 0) {
        gapEnd = matchOfNext[k];
        break;
      }
    }
    let best = -1;
    let bestScore = 0.45;
    for (let i = prevCursor; i < gapEnd; i++) {
      if (usedPrev.has(i) || prev[i].kind !== next[j].kind) continue;
      const score = similarity(prev[i].text, next[j].text);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best >= 0) {
      matchOfNext[j] = best;
      usedPrev.add(best);
      prevCursor = best + 1;
    }
  }

  return next.map((b, j) => ({ ...b, id: matchOfNext[j] >= 0 ? prev[matchOfNext[j]].id : makeId() }));
}

/** Dice coefficient over character bigrams (0 = unrelated, 1 = identical). */
export function similarity(a: string, b: string): number {
  a = a.trim().toLowerCase();
  b = b.trim().toLowerCase();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = grams.get(g) ?? 0;
    if (count > 0) {
      grams.set(g, count - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}
