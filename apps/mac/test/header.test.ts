import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, newId, parseHeader, serializeHeader, withHeader } from '../src/shared/header';

describe('note header', () => {
  const settings = { id: 'n1', ...DEFAULT_SETTINGS, template: 'grid' as const, size: 12, margins: 'wide' as const };

  it('round-trips through serialize/parse', () => {
    const text = serializeHeader(settings) + '= Title\n';
    const parsed = parseHeader(text)!;
    expect(parsed.settings).toEqual(settings);
    expect(parsed.lines).toBe(2);
    expect(text.slice(parsed.bodyOffset)).toBe('= Title\n');
  });

  it('only writes non-default margins and spacing', () => {
    const line = serializeHeader({ id: 'x', ...DEFAULT_SETTINGS }).split('\n')[1];
    expect(line).toBe('#show: note.with(id: "x", paper: "a4", template: "lined", font: "serif", size: 11pt)');
  });

  it('rejects notes without the header', () => {
    expect(parseHeader('= Just Typst\n')).toBeNull();
    expect(parseHeader('#import "/.typink/lib.typ": *\n= no show line\n')).toBeNull();
  });

  it('tolerates hand-edited spacing and unknown keys', () => {
    const text = '#import "/.typink/lib.typ": *\n#show: note.with(id:"n9",  template : "dotted", paper: "us-letter", extra: 3, size: 10.5pt)\nbody';
    const s = parseHeader(text)!.settings;
    expect([s.id, s.template, s.paper, s.size, s.font]).toEqual(['n9', 'dotted', 'us-letter', 10.5, 'serif']);
  });

  it('adds or replaces the header', () => {
    expect(withHeader('Hello', settings).endsWith('\nHello')).toBe(true);
    const updated = withHeader(serializeHeader(settings) + 'Body', { ...settings, template: 'blank' });
    expect(parseHeader(updated)!.settings.template).toBe('blank');
    expect(updated.endsWith('Body')).toBe(true);
  });

  it('makes short readable ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('s')));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^s[a-z2-9]{8}$/);
  });
});
