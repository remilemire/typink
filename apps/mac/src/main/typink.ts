// The main-process controller: owns settings, the library, the compiler and
// the window, and routes events between them (and, later, the iPad hub).

import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import type { Bootstrap, ExportResult, NewSketch, OpenedNote, TypinkEvents } from '@shared/api';
import { newId } from '@shared/header';
import type {
  AppSettings,
  ExportOptions,
  HubStatus,
  LayoutInfo,
  PaperTheme,
  PreviewResult,
  RendererCommand,
  SketchPlacement,
} from '@shared/types';
import { Annotations } from './anchors/annotations';
import { exportNote } from './export/export';
import { Hub } from './hub/hub';
import { emptySketchSvg, imageSize } from './ink/svg';
import { CompileHost } from './compile/host';
import { CompileService } from './compile/service';
import { SettingsStore } from './settings';
import { Library } from './store/library';

const AUTOSAVE_MS = 700;

export class Typink {
  readonly settings = new SettingsStore();
  library: Library;
  readonly host: CompileHost;
  readonly compiler: CompileService;
  readonly annotations: Annotations;
  readonly hub: Hub;
  window: BrowserWindow | null = null;

  /** The note open in the editor, relative to the library root. */
  activeNote: string | null = null;
  private firstRun = false;
  /** Latest editor text per note, and what we last wrote to disk. */
  private buffers = new Map<string, string>();
  private saved = new Map<string, string>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private watcher: fs.FSWatcher | null = null;
  private libraryTimer: NodeJS.Timeout | null = null;
  private readonly previewListeners = new Set<(result: PreviewResult) => void>();

  constructor() {
    nativeTheme.themeSource = this.settings.settings.appearance;
    this.library = new Library(this.settings.settings.libraryRoot);
    this.firstRun = this.library.ensure().created;
    this.host = new CompileHost(this.library.root);
    this.compiler = new CompileService(this.host, () => this.library.root);
    this.annotations = new Annotations(
      () => this.library,
      (rel) => this.noteText(rel),
    );
    this.hub = new Hub(this);
    this.compiler.on('preview', (result) => {
      if (result.ok) result.annotations = this.annotations.overlays(result.notePath, result.blocks);
      for (const listener of this.previewListeners) listener(result);
      if (result.notePath === this.activeNote) this.send('preview', result);
      if (result.ok) this.hub.noteChanged(result.notePath);
    });
    nativeTheme.on('updated', () => {
      this.send('appearance', { dark: nativeTheme.shouldUseDarkColors });
      this.recompileActive();
    });
  }

  start(): void {
    this.host.start();
    this.hub.start();
    this.watchLibrary();
    setTimeout(() => {
      try {
        this.library.collectUnusedInk();
      } catch (err) {
        console.warn('[library] ink cleanup failed', err);
      }
    }, 15_000);
  }

  shutdown(): void {
    for (const [rel] of this.saveTimers) this.flushSave(rel);
    this.annotations.flush();
    this.settings.flush();
    this.watcher?.close();
    this.hub.stop();
    this.host.stop();
  }

  onPreview(listener: (result: PreviewResult) => void): () => void {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  // ---- renderer plumbing --------------------------------------------------------

  send<E extends keyof TypinkEvents>(event: E, payload: TypinkEvents[E]): void {
    const win = this.window;
    if (win && !win.isDestroyed()) win.webContents.send(`event:${event}`, payload);
  }

  command(cmd: RendererCommand): void {
    this.send('command', cmd);
  }

  bootstrap(): Bootstrap {
    const firstRun = this.firstRun;
    this.firstRun = false;
    return {
      settings: this.settings.settings,
      library: this.library.list(),
      dark: nativeTheme.shouldUseDarkColors,
      firstRun,
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const before = this.settings.settings;
    const next = this.settings.update(patch);
    if (patch.appearance && patch.appearance !== before.appearance) nativeTheme.themeSource = patch.appearance;
    if (patch.paperFollowsTheme !== undefined && patch.paperFollowsTheme !== before.paperFollowsTheme) {
      this.recompileActive();
    }
    return next;
  }

  get paperTheme(): PaperTheme {
    return this.settings.settings.paperFollowsTheme && nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  // ---- library -----------------------------------------------------------------------

  async chooseLibrary(): Promise<ReturnType<Library['list']> | null> {
    const res = await dialog.showOpenDialog(this.window!, {
      title: 'Choose your Typink folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: this.library.root,
    });
    if (res.canceled || !res.filePaths[0]) return null;
    for (const rel of [...this.saveTimers.keys()]) this.flushSave(rel);
    this.library = new Library(res.filePaths[0]);
    this.library.ensure();
    this.settings.update({ libraryRoot: this.library.root, lastNote: null });
    this.activeNote = null;
    this.buffers.clear();
    this.saved.clear();
    this.annotations.reset();
    this.host.setRoot(this.library.root);
    this.watchLibrary();
    return this.library.list();
  }

  openNote(rel: string): OpenedNote {
    const previous = this.activeNote;
    if (previous && previous !== rel) {
      this.flushSave(previous);
      void this.compiler.release(previous);
      this.buffers.delete(previous);
    }
    const text = this.library.read(rel);
    this.activeNote = rel;
    this.saved.set(rel, text);
    this.buffers.set(rel, text);
    this.settings.update({ lastNote: rel });
    this.compiler.requestPreview(rel, this.paperTheme, text, 0);
    this.hub.activeNoteChanged();
    return { path: rel, text, sketches: this.sketchStates(text) };
  }

  /** Manifest state of every sketch a note refers to. */
  sketchStates(text: string): OpenedNote['sketches'] {
    const ink = this.library.readManifest().ink;
    const out: OpenedNote['sketches'] = {};
    for (const m of text.matchAll(/#sketch\(\s*"([\w-]+)"/g)) {
      const entry = ink[m[1]];
      if (entry) out[m[1]] = { rev: entry.rev, n: entry.n };
    }
    return out;
  }

  updateNote(rel: string, text: string): void {
    this.buffers.set(rel, text);
    this.compiler.requestPreview(rel, this.paperTheme, text);
    const timer = this.saveTimers.get(rel);
    if (timer) clearTimeout(timer);
    this.saveTimers.set(
      rel,
      setTimeout(() => this.flushSave(rel), AUTOSAVE_MS),
    );
  }

  saveNote(rel: string, text: string): void {
    this.buffers.set(rel, text);
    this.flushSave(rel);
  }

  /** Current text of a note: the live editor buffer when it's open, otherwise the file. */
  noteText(rel: string): string {
    return this.buffers.get(rel) ?? this.library.read(rel);
  }

  recompileActive(delayMs = 0): void {
    if (this.activeNote) this.compiler.requestPreview(this.activeNote, this.paperTheme, undefined, delayMs);
  }

  /** Something outside the text changed (ink, annotations): refresh the Mac preview and iPads. */
  recompileNote(rel: string): void {
    if (rel === this.activeNote) this.recompileActive();
    else this.hub.noteChanged(rel);
  }

  /** Waits until the active note has been compiled with this sketch in it. */
  async waitForSketchPlacement(
    id: string,
    timeoutMs: number,
  ): Promise<{ placement: SketchPlacement; layout: LayoutInfo | null; note: string } | null> {
    const find = (result: PreviewResult | undefined) => {
      const placement = result?.ok ? result.sketches.find((s) => s.id === id) : undefined;
      return placement && result ? { placement, layout: result.layout, note: result.notePath } : null;
    };
    const note = this.activeNote;
    const now = note ? find(this.compiler.latestPreview(note)) : null;
    if (now) return now;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
      const off = this.onPreview((result) => {
        const hit = find(result);
        if (!hit) return;
        clearTimeout(timer);
        off();
        resolve(hit);
      });
    });
  }

  renameEntry(rel: string, name: string): string {
    this.flushAllSaves();
    const next = this.library.rename(rel, name);
    this.remapOpenNote(rel, next);
    this.pushLibrary();
    return next;
  }

  moveEntry(rel: string, folder: string): string {
    this.flushAllSaves();
    const next = this.library.move(rel, folder);
    this.remapOpenNote(rel, next);
    this.pushLibrary();
    return next;
  }

  trashEntry(rel: string): void {
    this.flushAllSaves();
    if (this.activeNote && (this.activeNote === rel || this.activeNote.startsWith(`${rel}/`))) {
      void this.compiler.release(this.activeNote);
      this.activeNote = null;
    }
    this.library.trash(rel);
    this.pushLibrary();
  }

  revealEntry(rel: string): void {
    shell.showItemInFolder(this.library.abs(rel));
  }

  pushLibrary(): void {
    this.send('library', this.library.list());
    this.hub.libraryChanged();
  }

  // ---- sketches -------------------------------------------------------------------------

  /** Registers a new, empty sketch and returns the Typst call to insert at the cursor. */
  newSketch(options: { on?: string; open?: boolean }): NewSketch {
    const id = newId('s');
    const layout = this.activeNote ? this.compiler.latestPreview(this.activeNote)?.layout : null;
    const width = layout ? Math.round(layout.pageWidth - 2 * layout.marginX) : 470;
    let height = layout?.ruled ? Math.round(layout.pitch * 6 * 100) / 100 : 160;
    if (options.on) {
      const size = imageSize(fs.readFileSync(this.library.abs(options.on)));
      if (size) height = Math.round(((width * size.h) / size.w) * 100) / 100;
    }
    this.library.updateManifest((m) => {
      m.ink[id] = { w: width, h: height, n: 0, rev: 0, created: Date.now() };
    });
    fs.writeFileSync(this.library.inkPath(`${id}.svg`), emptySketchSvg(width, height));
    fs.writeFileSync(this.library.inkPath(`${id}.dark.svg`), emptySketchSvg(width, height));
    const snippet = options.on ? `#sketch("${id}", on: "${options.on}")` : `#sketch("${id}")`;
    return { id, snippet };
  }

  /** Opens a sketch on the connected iPad; false when no iPad is connected. */
  editSketch(id: string): boolean {
    return this.hub.openSketch(id);
  }

  // ---- export & devices ---------------------------------------------------------------

  async exportNote(rel: string, options: ExportOptions): Promise<ExportResult | null> {
    this.flushSave(rel);
    return exportNote(this, rel, options);
  }

  /** Writes the note's annotation placements for baking into an export; false if it has none. */
  async prepareAnnotationExport(rel: string): Promise<boolean> {
    if (!this.annotations.hasAnnotations(rel)) return false;
    let blocks = rel === this.activeNote ? this.compiler.latestPreview(rel)?.blocks : undefined;
    if (!blocks) {
      const out = await this.compiler.compile(rel, { theme: 'light' }, { query: true });
      if (!out.ok) return false;
      blocks = this.compiler.toPreview(rel, 0, 'light', out).blocks;
    }
    return this.annotations.writePlacements(rel, blocks);
  }

  hubStatus(): HubStatus {
    return this.hub.status();
  }

  revokeDevice(id: string): void {
    this.hub.revoke(id);
  }

  // ---- internals ------------------------------------------------------------------------

  private remapOpenNote(from: string, to: string): void {
    const remap = (rel: string) => (rel === from ? to : rel.startsWith(`${from}/`) ? to + rel.slice(from.length) : rel);
    if (this.activeNote) {
      const next = remap(this.activeNote);
      if (next !== this.activeNote) {
        void this.compiler.release(this.activeNote);
        const text = this.buffers.get(this.activeNote);
        this.buffers.delete(this.activeNote);
        this.saved.delete(this.activeNote);
        this.activeNote = next;
        if (text !== undefined) {
          this.buffers.set(next, text);
          this.saved.set(next, text);
        }
        this.settings.update({ lastNote: next });
        this.recompileActive();
      }
    }
  }

  private flushAllSaves(): void {
    for (const rel of [...this.saveTimers.keys()]) this.flushSave(rel);
  }

  private flushSave(rel: string): void {
    const timer = this.saveTimers.get(rel);
    if (timer) clearTimeout(timer);
    this.saveTimers.delete(rel);
    const text = this.buffers.get(rel);
    if (text === undefined || text === this.saved.get(rel)) return;
    try {
      this.library.write(rel, text);
      this.saved.set(rel, text);
    } catch (err) {
      this.command({ type: 'toast', message: `Couldn't save ${rel}: ${(err as Error).message}` });
    }
  }

  private watchLibrary(): void {
    this.watcher?.close();
    try {
      this.watcher = fs.watch(this.library.root, { recursive: true }, (_event, file) => {
        if (!file) return;
        const rel = String(file).split(path.sep).join('/');
        if (rel.startsWith('.typink/')) return;
        if (this.libraryTimer) clearTimeout(this.libraryTimer);
        this.libraryTimer = setTimeout(() => {
          this.pushLibrary();
          this.checkExternalEdit();
        }, 200);
      });
      this.watcher.on('error', (err) => {
        // The folder moved or went away: keep working, just without noticing outside edits.
        console.warn('[library] stopped watching folder', err);
        this.watcher?.close();
        this.watcher = null;
      });
    } catch (err) {
      console.warn('[library] cannot watch folder', err);
    }
  }

  /** Reloads the open note if another app changed it and we have no unsaved edits. */
  private checkExternalEdit(): void {
    const rel = this.activeNote;
    if (!rel) return;
    let disk: string;
    try {
      disk = this.library.read(rel);
    } catch {
      return;
    }
    const saved = this.saved.get(rel);
    if (disk === saved) return;
    const buffer = this.buffers.get(rel);
    if (buffer !== saved) {
      this.command({ type: 'toast', message: `${rel} changed on disk; keeping your version` });
      return;
    }
    this.saved.set(rel, disk);
    this.buffers.set(rel, disk);
    this.compiler.requestPreview(rel, this.paperTheme, disk, 0);
    this.send('note-external', { path: rel, text: disk, sketches: this.sketchStates(disk) });
  }
}
