// The notes library: plain .typ files under a root folder that is also the Typst root.
//
//   <root>/<Notebook>/<Note>.typ     notes (folders are notebooks)
//   <root>/attachments/              imported images and PDFs
//   <root>/.typink/                  lib.typ, manifest.json, ink/, ann/, trash/

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import libSource from '@typink/typst-lib/lib.typ?raw';
import { DEFAULT_SETTINGS, newId, serializeHeader } from '@shared/header';
import type { LibraryListing, NoteMeta } from '@shared/types';

export const APP_DIR = '.typink';
const ATTACHMENTS = 'attachments';

export interface Manifest {
  v: 1;
  /** Sketch id → canvas size (pt) and stroke count. */
  ink: Record<string, { w: number; h: number; n: number; rev: number; created: number }>;
}

export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const toPosix = (p: string) => p.split(path.sep).join('/');

export class Library {
  constructor(readonly root: string) {}

  /** Creates the folder structure and installs/updates the Typst library. */
  ensure(): { created: boolean } {
    const created = !fs.existsSync(this.root);
    for (const dir of [APP_DIR, `${APP_DIR}/ink`, `${APP_DIR}/ann`, `${APP_DIR}/trash`, ATTACHMENTS]) {
      fs.mkdirSync(path.join(this.root, dir), { recursive: true });
    }
    const libFile = path.join(this.root, APP_DIR, 'lib.typ');
    const current = fs.existsSync(libFile) ? fs.readFileSync(libFile, 'utf8') : null;
    if (current !== libSource) writeFileAtomic(libFile, libSource);
    if (!fs.existsSync(this.manifestPath)) writeFileAtomic(this.manifestPath, JSON.stringify({ v: 1, ink: {} }));
    if (created) this.writeWelcome();
    return { created };
  }

  // ---- paths ---------------------------------------------------------------

  /** Resolves a library-relative path, refusing anything that escapes the root. */
  abs(rel: string): string {
    const resolved = path.resolve(this.root, rel.replace(/^\/+/, ''));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error(`path outside the library: ${rel}`);
    }
    return resolved;
  }

  rel(abs: string): string {
    return toPosix(path.relative(this.root, abs));
  }

  // ---- notes ---------------------------------------------------------------

  list(): LibraryListing {
    const folders: string[] = [];
    const notes: NoteMeta[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const rel = this.rel(full);
        if (entry.isDirectory()) {
          if (rel === ATTACHMENTS) continue;
          folders.push(rel);
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.typ')) {
          const stat = fs.statSync(full);
          notes.push({
            path: rel,
            name: entry.name.slice(0, -4),
            folder: toPosix(path.dirname(rel)) === '.' ? '' : toPosix(path.dirname(rel)),
            mtime: stat.mtimeMs,
          });
        }
      }
    };
    if (fs.existsSync(this.root)) walk(this.root);
    folders.sort((a, b) => a.localeCompare(b));
    notes.sort((a, b) => b.mtime - a.mtime);
    return { root: this.root, folders, notes };
  }

  read(rel: string): string {
    return fs.readFileSync(this.abs(rel), 'utf8');
  }

  write(rel: string, text: string): void {
    writeFileAtomic(this.abs(rel), text);
  }

  create(folder: string, name: string): NoteMeta {
    const dir = this.abs(folder);
    fs.mkdirSync(dir, { recursive: true });
    const base = sanitizeName(name) || 'Untitled';
    let file = path.join(dir, `${base}.typ`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} ${i}.typ`);
    const title = path.basename(file, '.typ');
    const text = `${serializeHeader({ id: newId('n'), ...DEFAULT_SETTINGS })}\n= ${title}\n\n`;
    writeFileAtomic(file, text);
    const rel = this.rel(file);
    return { path: rel, name: title, folder, mtime: Date.now() };
  }

  createFolder(name: string): string {
    const base = sanitizeName(name) || 'Notebook';
    let dir = this.abs(base);
    for (let i = 2; fs.existsSync(dir); i++) dir = this.abs(`${base} ${i}`);
    fs.mkdirSync(dir, { recursive: true });
    return this.rel(dir);
  }

  rename(rel: string, newName: string): string {
    const from = this.abs(rel);
    const base = sanitizeName(newName);
    if (!base) throw new Error('name is empty');
    const to = path.join(path.dirname(from), fs.statSync(from).isDirectory() ? base : `${base}.typ`);
    if (to === from) return rel;
    if (fs.existsSync(to)) throw new Error(`“${base}” already exists`);
    fs.renameSync(from, to);
    return this.rel(to);
  }

  move(rel: string, folder: string): string {
    const from = this.abs(rel);
    const to = path.join(this.abs(folder), path.basename(from));
    if (to === from) return rel;
    if (fs.existsSync(to)) throw new Error(`“${path.basename(to)}” already exists in that folder`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return this.rel(to);
  }

  /** Moves a note or folder into .typink/trash (never deletes). */
  trash(rel: string): void {
    const from = this.abs(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const to = path.join(this.root, APP_DIR, 'trash', `${stamp} ${path.basename(from)}`);
    fs.renameSync(from, to);
  }

  // ---- attachments -----------------------------------------------------------

  /** Stores bytes in attachments/ (deduplicated by content) and returns the root-absolute Typst path. */
  importAttachment(data: Uint8Array, ext: string): string {
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 12);
    const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const name = `${hash}.${clean === 'jpeg' ? 'jpg' : clean}`;
    const file = path.join(this.root, ATTACHMENTS, name);
    if (!fs.existsSync(file)) writeFileAtomic(file, data);
    return `/${ATTACHMENTS}/${name}`;
  }

  // ---- ink manifest ------------------------------------------------------------

  get manifestPath(): string {
    return path.join(this.root, APP_DIR, 'manifest.json');
  }

  readManifest(): Manifest {
    try {
      const m = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as Manifest;
      return { v: 1, ink: m.ink ?? {} };
    } catch {
      return { v: 1, ink: {} };
    }
  }

  updateManifest(fn: (m: Manifest) => void): Manifest {
    const m = this.readManifest();
    fn(m);
    writeFileAtomic(this.manifestPath, JSON.stringify(m));
    return m;
  }

  /**
   * Moves sketches that no note refers to any more (and that are older than
   * `days`, so an undo can still bring them back) into .typink/trash.
   */
  collectUnusedInk(days = 30): number {
    const referenced = new Set<string>();
    for (const note of this.list().notes) {
      try {
        for (const m of this.read(note.path).matchAll(/sketch\(\s*"([\w-]+)"/g)) referenced.add(m[1]);
      } catch {
        // unreadable note: keep everything
        return 0;
      }
    }
    const cutoff = Date.now() - days * 86_400_000;
    const trash = path.join(this.root, APP_DIR, 'trash');
    let moved = 0;
    this.updateManifest((m) => {
      for (const [id, info] of Object.entries(m.ink)) {
        if (referenced.has(id) || (info.created ?? 0) > cutoff) continue;
        for (const ext of ['.svg', '.dark.svg', '.json', '.pkdrawing']) {
          const file = this.inkPath(id + ext);
          if (fs.existsSync(file)) fs.renameSync(file, path.join(trash, `ink-${id}${ext}`));
        }
        delete m.ink[id];
        moved++;
      }
    });
    return moved;
  }

  inkPath(file: string): string {
    return path.join(this.root, APP_DIR, 'ink', file);
  }

  annPath(file: string): string {
    return path.join(this.root, APP_DIR, 'ann', file);
  }

  // ---- first run -----------------------------------------------------------------

  private writeWelcome(): void {
    const sketchId = 'welcome';
    this.updateManifest((m) => {
      m.ink[sketchId] = { w: 480, h: 144, n: 0, rev: 0, created: Date.now() };
    });
    const header = serializeHeader({ id: 'welcome', ...DEFAULT_SETTINGS });
    const body = `
= Welcome to Typink

Type your notes in *Typst* on the left and watch them land on paper on the right. Type \`/\` at the start of a line for headings, lists, callouts, math, tables and more.

== Handwriting from your iPad
Open Typink on your iPad and pair it using the iPad button in the top bar. Then press *⌘⇧D* to drop a sketch at the cursor and draw it with Apple Pencil.

#sketch("${sketchId}")

== Things to try
#task(done: true)[Open Typink]
#task[Switch the paper between blank, lined, grid and dotted in the top bar]
#task[Drag an image into the editor]
#task[Export as PDF, PNG or JPEG]

#tip[Notes are plain \`.typ\` files in *Documents › Typink*, so they work with Git, iCloud Drive and the \`typst\` command line.]

$ e^(i pi) + 1 = 0 $
`;
    writeFileAtomic(path.join(this.root, 'Notes', 'Welcome.typ'), header + body);
  }
}

export function sanitizeName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
}
