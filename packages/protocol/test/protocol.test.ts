import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, fromPad, packParts, part, toPad } from '../src/index';

const fixtures = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures');
const load = (dir: string) =>
  fs.readdirSync(path.join(fixtures, dir)).map((f) => [f, JSON.parse(fs.readFileSync(path.join(fixtures, dir, f), 'utf8'))] as const);

describe('fixtures', () => {
  it.each(load('fromPad'))('iPad → Mac %s is valid', (_name, msg) => {
    expect(() => fromPad.parse(msg)).not.toThrow();
  });
  it.each(load('toPad'))('Mac → iPad %s is valid', (_name, msg) => {
    expect(() => toPad.parse(msg)).not.toThrow();
  });
});

describe('validation', () => {
  it('rejects unknown message types and path traversal', () => {
    expect(fromPad.safeParse({ t: 'deleteEverything' }).success).toBe(false);
    expect(fromPad.safeParse({ t: 'view', note: '../../etc/passwd', theme: 'light' }).success).toBe(false);
    expect(fromPad.safeParse({ t: 'pair', code: '12345' }).success).toBe(false);
  });
  it('rejects ragged point arrays', () => {
    const bad = { t: 'sketchPut', id: 's1', rev: 1, size: { w: 10, h: 10 }, render: [{ ink: 'pen', color: '#000000ff', colorDark: '#ffffffff', points: [1, 2, 3] }], parts: { pk: [0, 0] } };
    expect(fromPad.safeParse(bad).success).toBe(false);
  });
});

describe('binary frames', () => {
  it('round-trips a header and named parts', () => {
    const pk = new Uint8Array([1, 2, 3]);
    const bg = new Uint8Array([9, 8, 7, 6]);
    const { payload, ranges } = packParts({ pk, background: bg });
    const frame = encodeFrame({ t: 'sketchOpen', parts: ranges }, payload);
    const decoded = decodeFrame(frame);
    const header = decoded.header as { t: string; parts: { pk: [number, number]; background: [number, number] } };
    expect(header.t).toBe('sketchOpen');
    expect([...part(decoded.payload, header.parts.pk)!]).toEqual([1, 2, 3]);
    expect([...part(decoded.payload, header.parts.background)!]).toEqual([9, 8, 7, 6]);
  });
  it('rejects truncated frames', () => {
    expect(() => decodeFrame(new Uint8Array([0, 0, 0, 50, 1]))).toThrow();
    expect(() => part(new Uint8Array(4), [2, 10])).toThrow();
  });
});
