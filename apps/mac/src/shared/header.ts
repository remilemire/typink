// The two app-managed lines every note starts with:
//   #import "/.typink/lib.typ": *
//   #show: note.with(id: "n7x2k9", paper: "a4", template: "lined", font: "serif", size: 11pt)

import type { NoteSettings } from './types';

export const IMPORT_LINE = '#import "/.typink/lib.typ": *';
const SHOW_PREFIX = '#show: note.with(';

export const DEFAULT_SETTINGS: Omit<NoteSettings, 'id'> = {
  paper: 'a4',
  template: 'lined',
  font: 'serif',
  size: 11,
  margins: 'normal',
  spacing: 'normal',
};

export interface ParsedHeader {
  settings: NoteSettings;
  /** Number of lines the header occupies (0 when the note has no header). */
  lines: number;
  /** Character offset where the body starts. */
  bodyOffset: number;
}

/** Parses the header, or returns null when the note doesn't start with one. */
export function parseHeader(text: string): ParsedHeader | null {
  const first = text.indexOf('\n');
  if (first < 0 || text.slice(0, first).trim() !== IMPORT_LINE) return null;
  const secondEnd = text.indexOf('\n', first + 1);
  const second = text.slice(first + 1, secondEnd < 0 ? undefined : secondEnd).trim();
  if (!second.startsWith(SHOW_PREFIX) || !second.endsWith(')')) return null;

  const args = second.slice(SHOW_PREFIX.length, -1);
  const values: Record<string, string> = {};
  for (const m of args.matchAll(/([a-z][\w-]*)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|([\w.]+))/g)) {
    values[m[1]] = m[2] ?? m[3];
  }
  const size = parseFloat(values.size ?? '');
  const settings: NoteSettings = {
    id: values.id ?? '',
    paper: (values.paper as NoteSettings['paper']) ?? DEFAULT_SETTINGS.paper,
    template: (values.template as NoteSettings['template']) ?? 'blank',
    font: values.font ?? DEFAULT_SETTINGS.font,
    size: Number.isFinite(size) ? size : DEFAULT_SETTINGS.size,
    margins: (values.margins as NoteSettings['margins']) ?? DEFAULT_SETTINGS.margins,
    spacing: (values.spacing as NoteSettings['spacing']) ?? DEFAULT_SETTINGS.spacing,
  };
  const bodyOffset = secondEnd < 0 ? text.length : secondEnd + 1;
  return { settings, lines: 2, bodyOffset };
}

export function serializeHeader(s: NoteSettings): string {
  const parts = [`id: "${s.id}"`, `paper: "${s.paper}"`, `template: "${s.template}"`, `font: "${s.font}"`, `size: ${s.size}pt`];
  if (s.margins !== 'normal') parts.push(`margins: "${s.margins}"`);
  if (s.spacing !== 'normal') parts.push(`spacing: "${s.spacing}"`);
  return `${IMPORT_LINE}\n${SHOW_PREFIX}${parts.join(', ')})\n`;
}

/** Returns the text with its header replaced (or added when missing). */
export function withHeader(text: string, settings: NoteSettings): string {
  const parsed = parseHeader(text);
  const body = parsed ? text.slice(parsed.bodyOffset) : text;
  return serializeHeader(settings) + body;
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Short random ids for notes, sketches and annotation clusters. */
export function newId(prefix = '', length = 8): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let id = prefix;
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}
