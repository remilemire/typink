// Typink wire protocol v1 — Mac (Electron) ⇄ iPad (SwiftUI + PencilKit) over WebSocket.
//
// Text frames carry a JSON object with a `t` field. Binary frames carry bulky data
// (PDFs, PencilKit drawings, images) as:
//
//   [u32 big-endian header length][header JSON, UTF-8][payload bytes]
//
// where the header is a message like any text frame and `parts` names byte ranges
// ([offset, length]) inside the payload. See docs/protocol.md.

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const SERVICE_TYPE = '_typink._tcp';

// ---- shared shapes ------------------------------------------------------------

const id = z.string().regex(/^[\w-]{1,64}$/);
const notePath = z.string().min(1).max(512).refine((p) => !p.includes('..') && !p.startsWith('/'), 'bad note path');
const attachmentPath = z.string().regex(/^\/attachments\/[\w.-]{1,128}$/);
const colour = z.string().regex(/^#[0-9a-fA-F]{8}$/);
const byteRange = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const size = z.object({ w: z.number().positive().max(20_000), h: z.number().positive().max(200_000) });

export const inkTypes = ['pen', 'pencil', 'marker', 'monoline', 'fountainPen', 'other'] as const;

/** One visible stroke segment, already transformed into canvas/page coordinates (pt). */
export const renderStroke = z.object({
  ink: z.enum(inkTypes),
  color: colour,
  colorDark: colour,
  /** Flattened [x, y, width, opacity] per sample. */
  points: z
    .array(z.number().finite())
    .max(4 * 20_000)
    .refine((a) => a.length % 4 === 0, 'points must come in groups of 4'),
});
export type RenderStroke = z.infer<typeof renderStroke>;

export const ruling = z.object({
  template: z.enum(['blank', 'lined', 'grid', 'dotted']),
  pitch: z.number().positive(),
  /** Where the first rule/grid line falls inside the canvas, in pt. */
  offsetX: z.number(),
  offsetY: z.number(),
});
export type Ruling = z.infer<typeof ruling>;

export const sketchPlacement = z.object({
  id,
  page: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  on: z.string().nullable(),
});

export const noteSummary = z.object({ path: z.string(), name: z.string(), folder: z.string(), mtime: z.number() });

// ---- iPad → Mac ----------------------------------------------------------------------

export const hello = z.object({
  t: z.literal('hello'),
  proto: z.number().int(),
  deviceId: z.string().uuid(),
  name: z.string().min(1).max(80),
  token: z.string().max(200).optional(),
  appearance: z.enum(['light', 'dark']),
});

export const pair = z.object({ t: z.literal('pair'), code: z.string().regex(/^\d{6}$/) });
export const listNotes = z.object({ t: z.literal('listNotes') });
/** Which note the iPad shows; null follows the note open on the Mac. */
export const view = z.object({ t: z.literal('view'), note: notePath.nullable(), theme: z.enum(['light', 'dark']) });
export const sketchNew = z.object({ t: z.literal('sketchNew'), note: notePath.optional() });
export const sketchRequest = z.object({ t: z.literal('sketchRequest'), id });
export const sketchPut = z.object({
  t: z.literal('sketchPut'),
  id,
  rev: z.number().int().nonnegative(),
  size,
  render: z.array(renderStroke).max(5_000),
  parts: z.object({ pk: byteRange }),
});
export const sketchClose = z.object({ t: z.literal('sketchClose'), id });
export const annotatePut = z.object({
  t: z.literal('annotatePut'),
  note: notePath,
  viewedRev: z.number().int().nonnegative(),
  /** Pages the iPad edited; clusters on other pages are left alone. */
  pages: z.array(z.number().int().positive()).max(1_000),
  clusters: z
    .array(
      z.object({
        id,
        page: z.number().int().positive(),
        /** Page-space bounds [x, y, w, h] (pt). */
        bbox: z.tuple([z.number(), z.number(), z.number().nonnegative(), z.number().nonnegative()]),
        /** Strokes in cluster-local coordinates (origin at bbox x, y). */
        render: z.array(renderStroke).max(5_000),
        pk: byteRange,
      }),
    )
    .max(2_000),
});
export const image = z.object({
  t: z.literal('image'),
  note: notePath.optional(),
  name: z.string().max(200),
  mime: z.enum(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']),
  mode: z.enum(['insert', 'drawOn']),
  parts: z.object({ data: byteRange }),
});

export const fromPad = z.discriminatedUnion('t', [
  hello,
  pair,
  listNotes,
  view,
  sketchNew,
  sketchRequest,
  sketchPut,
  sketchClose,
  annotatePut,
  image,
]);
export type FromPad = z.infer<typeof fromPad>;

// ---- Mac → iPad ------------------------------------------------------------------------

export const welcome = z.object({ t: z.literal('welcome'), proto: z.number().int(), macName: z.string() });
export const pairNeeded = z.object({ t: z.literal('pairNeeded'), macName: z.string() });
export const paired = z.object({ t: z.literal('paired'), token: z.string() });
export const pairFailed = z.object({ t: z.literal('pairFailed'), reason: z.string() });
export const notes = z.object({ t: z.literal('notes'), notes: z.array(noteSummary), active: z.string().nullable() });
export const note = z.object({
  t: z.literal('note'),
  note: z.string(),
  title: z.string(),
  rev: z.number().int(),
  following: z.boolean(),
  pages: z.array(z.object({ w: z.number(), h: z.number() })),
  sketches: z.array(sketchPlacement),
  ruling: ruling.nullable(),
});
export const pdf = z.object({
  t: z.literal('pdf'),
  note: z.string(),
  rev: z.number().int(),
  theme: z.enum(['light', 'dark']),
  parts: z.object({ data: byteRange }),
});
export const annotations = z.object({
  t: z.literal('annotations'),
  note: z.string(),
  rev: z.number().int(),
  clusters: z.array(
    z.object({ id, page: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), pk: byteRange }),
  ),
});
export const sketchOpen = z.object({
  t: z.literal('sketchOpen'),
  note: z.string(),
  id,
  rev: z.number().int(),
  size,
  ruling: ruling.nullable(),
  background: z.object({ path: z.string(), mime: z.string(), page: z.number().int().nullable() }).nullable(),
  parts: z.object({ pk: byteRange.optional(), background: byteRange.optional() }),
});
export const sketchAck = z.object({ t: z.literal('sketchAck'), id, rev: z.number().int() });
export const annotateAck = z.object({ t: z.literal('annotateAck'), note: z.string() });
export const toast = z.object({ t: z.literal('toast'), message: z.string() });

export const toPad = z.discriminatedUnion('t', [
  welcome,
  pairNeeded,
  paired,
  pairFailed,
  notes,
  note,
  pdf,
  annotations,
  sketchOpen,
  sketchAck,
  annotateAck,
  toast,
]);
export type ToPad = z.infer<typeof toPad>;

// ---- binary framing ------------------------------------------------------------------

export interface Frame<T> {
  header: T;
  payload: Uint8Array;
}

export function encodeFrame(header: object, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + payload.length);
  new DataView(out.buffer).setUint32(0, json.length, false);
  out.set(json, 4);
  out.set(payload, 4 + json.length);
  return out;
}

export function decodeFrame(data: Uint8Array): Frame<unknown> {
  if (data.length < 4) throw new Error('frame too short');
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
  if (length > data.length - 4) throw new Error('bad frame header length');
  const header = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + length))) as unknown;
  return { header, payload: data.subarray(4 + length) };
}

/** Reads a named byte range out of a frame's payload. */
export function part(payload: Uint8Array, range: readonly [number, number] | undefined): Uint8Array | null {
  if (!range) return null;
  const [offset, length] = range;
  if (offset + length > payload.length) throw new Error('byte range outside payload');
  return payload.subarray(offset, offset + length);
}

/** Packs several blobs into one payload and returns their ranges. */
export function packParts<K extends string>(parts: Record<K, Uint8Array | null | undefined>): {
  payload: Uint8Array;
  ranges: Partial<Record<K, [number, number]>>;
} {
  let total = 0;
  for (const blob of Object.values(parts) as (Uint8Array | null | undefined)[]) total += blob?.length ?? 0;
  const payload = new Uint8Array(total);
  const ranges: Partial<Record<K, [number, number]>> = {};
  let offset = 0;
  for (const [key, blob] of Object.entries(parts) as [K, Uint8Array | null | undefined][]) {
    if (!blob) continue;
    payload.set(blob, offset);
    ranges[key] = [offset, blob.length];
    offset += blob.length;
  }
  return { payload, ranges };
}
