// Turns a pressure-sensitive stroke (samples of x, y, width) into a filled
// outline: offset both sides along the normal, add round caps, then smooth the
// polygon with quadratic curves through edge midpoints.

export type Sample = readonly [x: number, y: number, width: number];

const CAP_SEGMENTS = 8;
const MIN_WIDTH = 0.35;

const round = (v: number) => Math.round(v * 100) / 100;

/** Drops samples that sit on top of their predecessor (they produce NaN normals). */
function dedupe(samples: Sample[]): Sample[] {
  const out: Sample[] = [];
  for (const s of samples) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 0.05) out.push(s);
    else if (s[2] > prev[2]) out[out.length - 1] = [prev[0], prev[1], s[2]];
  }
  return out;
}

function circlePath(x: number, y: number, r: number): string {
  return `M${round(x - r)} ${round(y)}a${round(r)} ${round(r)} 0 1 0 ${round(2 * r)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-2 * r)} 0Z`;
}

/** Points of a half circle around (cx, cy) from angle a0, sweeping π radians. */
function arc(cx: number, cy: number, r: number, a0: number, clockwise: boolean): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const a = a0 + ((clockwise ? 1 : -1) * Math.PI * i) / CAP_SEGMENTS;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function strokeOutline(raw: Sample[]): string {
  const samples = dedupe(raw.map(([x, y, w]) => [x, y, Math.max(MIN_WIDTH, w)] as Sample));
  if (samples.length === 0) return '';
  if (samples.length === 1) {
    const [x, y, w] = samples[0];
    return circlePath(x, y, w / 2);
  }

  const n = samples.length;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, w] = samples[i];
    const [px, py] = samples[Math.max(0, i - 1)];
    const [nx, ny] = samples[Math.min(n - 1, i + 1)];
    // Tangent: average of the incoming and outgoing directions.
    let tx = 0;
    let ty = 0;
    if (i > 0) {
      const l = Math.hypot(x - px, y - py);
      tx += (x - px) / l;
      ty += (y - py) / l;
    }
    if (i < n - 1) {
      const l = Math.hypot(nx - x, ny - y);
      tx += (nx - x) / l;
      ty += (ny - y) / l;
    }
    let tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      // A hairpin turn: fall back to the outgoing direction.
      tx = nx - x || x - px;
      ty = ny - y || y - py;
      tl = Math.hypot(tx, ty) || 1;
    }
    const r = w / 2;
    const ox = (-ty / tl) * r;
    const oy = (tx / tl) * r;
    left.push([x + ox, y + oy]);
    right.push([x - ox, y - oy]);
  }

  const [ex, ey, ew] = samples[n - 1];
  const [sx, sy, sw] = samples[0];
  const endAngle = Math.atan2(left[n - 1][1] - ey, left[n - 1][0] - ex);
  const startAngle = Math.atan2(right[0][1] - sy, right[0][0] - sx);
  const polygon: [number, number][] = [
    ...left,
    ...arc(ex, ey, ew / 2, endAngle, false),
    ...right.reverse(),
    ...arc(sx, sy, sw / 2, startAngle, false),
  ];
  return smoothClosedPath(polygon);
}

/** Closed quadratic spline through the midpoints of the polygon's edges. */
function smoothClosedPath(points: [number, number][]): string {
  const len = points.length;
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = mid(points[len - 1], points[0]);
  let d = `M${round(start[0])} ${round(start[1])}`;
  for (let i = 0; i < len; i++) {
    const p = points[i];
    const m = mid(p, points[(i + 1) % len]);
    d += `Q${round(p[0])} ${round(p[1])} ${round(m[0])} ${round(m[1])}`;
  }
  return `${d}Z`;
}
