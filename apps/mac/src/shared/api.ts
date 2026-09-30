// The API the preload script exposes to the renderer as `window.typink`.

import type {
  AppSettings,
  ExportOptions,
  HubStatus,
  LibraryListing,
  NoteMeta,
  PreviewResult,
  RendererCommand,
} from './types';

export interface Bootstrap {
  settings: AppSettings;
  library: LibraryListing;
  dark: boolean;
  firstRun: boolean;
}

export interface SketchState {
  rev: number;
  /** Stroke count; 0 while the sketch is empty. */
  n: number;
}

export interface OpenedNote {
  path: string;
  text: string;
  /** Known sketches (from the ink manifest) referenced by the note. */
  sketches: Record<string, SketchState>;
}

export interface NewSketch {
  id: string;
  snippet: string;
}

export interface ExportResult {
  files: string[];
}

/** Events pushed from the main process. */
export interface TypinkEvents {
  preview: PreviewResult;
  library: LibraryListing;
  'note-external': OpenedNote;
  command: RendererCommand;
  appearance: { dark: boolean };
  hub: HubStatus;
  'sketch-updated': { id: string } & SketchState;
}

export interface TypinkApi {
  bootstrap(): Promise<Bootstrap>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseLibrary(): Promise<LibraryListing | null>;

  listLibrary(): Promise<LibraryListing>;
  openNote(path: string): Promise<OpenedNote>;
  /** Live editor text: recompiles the preview and autosaves shortly after. */
  updateNote(path: string, text: string): Promise<void>;
  saveNote(path: string, text: string): Promise<void>;
  createNote(folder: string, name: string): Promise<NoteMeta>;
  createFolder(name: string): Promise<string>;
  renameEntry(path: string, name: string): Promise<string>;
  moveEntry(path: string, folder: string): Promise<string>;
  trashEntry(path: string): Promise<void>;
  revealEntry(path: string): Promise<void>;

  importAttachment(data: Uint8Array, ext: string): Promise<string>;
  pickAttachments(): Promise<string[]>;

  newSketch(options: { on?: string; open?: boolean }): Promise<NewSketch>;
  editSketch(id: string): Promise<boolean>;

  exportNote(path: string, options: ExportOptions): Promise<ExportResult | null>;

  revealFile(absolutePath: string): Promise<void>;

  hubStatus(): Promise<HubStatus>;
  revokeDevice(id: string): Promise<void>;

  on<E extends keyof TypinkEvents>(event: E, listener: (payload: TypinkEvents[E]) => void): () => void;
}
