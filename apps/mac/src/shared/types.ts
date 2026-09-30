// Types shared by the main process, the preload bridge and the renderer.

export type AppearanceSetting = 'system' | 'light' | 'dark';
export type PaperTheme = 'light' | 'dark';
export type ViewMode = 'editor' | 'split' | 'preview';

export type Paper = 'a4' | 'us-letter' | 'endless';
export type Template = 'blank' | 'lined' | 'grid' | 'dotted';
export type FontChoice = 'serif' | 'sans' | 'modern' | 'mono';
export type Margins = 'narrow' | 'normal' | 'wide';
export type LineSpacing = 'compact' | 'normal' | 'wide';

/** The arguments of `#show: note.with(...)` in a note's header. */
export interface NoteSettings {
  id: string;
  paper: Paper;
  template: Template;
  font: FontChoice | string;
  size: number; // pt
  margins: Margins;
  spacing: LineSpacing;
}

export interface NoteMeta {
  /** Path relative to the library root, with forward slashes, e.g. "Physics/Lecture 3.typ". */
  path: string;
  name: string;
  folder: string;
  mtime: number;
}

export interface LibraryListing {
  root: string;
  folders: string[];
  notes: NoteMeta[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** Path relative to the library root. */
  path: string;
  /** 0-based line/column range, or null when Typst gave no location. */
  range: { startLine: number; startCol: number; endLine: number; endCol: number } | null;
}

export interface LayoutInfo {
  template: Template;
  ruled: boolean;
  pitch: number;
  originX: number;
  originY: number;
  pageWidth: number;
  marginX: number;
}

export interface SketchPlacement {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Background image/PDF path for draw-on-image sketches. */
  on: string | null;
  /** Page of a PDF background. */
  onPage: number | null;
}

export interface BlockAnchor {
  page: number;
  kind: string;
  x: number;
  y: number;
  text: string;
  src: string | null;
}

export interface PageSize {
  w: number;
  h: number;
}

/** Positioned annotation cluster, ready to draw over a page (all units pt). */
export interface AnnotationOverlay {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** typink:// URLs of the light and dark renderings. */
  url: string;
  urlDark: string;
}

export interface PreviewResult {
  notePath: string;
  rev: number;
  theme: PaperTheme;
  ok: boolean;
  /** typst.ts SVG for the whole document; only present when compilation succeeded. */
  svg?: string;
  pages: PageSize[];
  diagnostics: Diagnostic[];
  sketches: SketchPlacement[];
  blocks: BlockAnchor[];
  layout: LayoutInfo | null;
  annotations: AnnotationOverlay[];
  ms: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  pairedAt: number;
  connected: boolean;
}

export interface HubStatus {
  port: number;
  host: string;
  addresses: string[];
  pairingCode: string;
  qrPayload: string;
  devices: DeviceInfo[];
  error: string | null;
}

export interface AppSettings {
  libraryRoot: string;
  appearance: AppearanceSetting;
  paperFollowsTheme: boolean;
  hubPort: number;
  lastNote: string | null;
  viewMode: ViewMode;
  sidebar: boolean;
}

export type ExportFormat = 'pdf' | 'png' | 'jpeg';

export interface ExportOptions {
  format: ExportFormat;
  theme: PaperTheme;
  annotations: boolean;
  /** For raster formats. */
  dpi: number;
  quality: number;
  pages: 'all' | 'current' | { from: number; to: number };
  currentPage: number;
}

/** Actions the main process asks the renderer to perform (menus, iPad requests). */
export type RendererCommand =
  | { type: 'new-note' }
  | { type: 'new-folder' }
  | { type: 'insert'; text: string; block: boolean }
  | { type: 'replace'; from: string; to: string }
  | { type: 'format'; action: FormatAction }
  | { type: 'view-mode'; mode: ViewMode | 'cycle' }
  | { type: 'toggle-sidebar' }
  | { type: 'export'; format: ExportFormat }
  | { type: 'new-sketch' }
  | { type: 'import-image' }
  | { type: 'show-devices' }
  | { type: 'focus-search' }
  | { type: 'zoom'; delta: number | 'reset' }
  | { type: 'toast'; message: string };

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'code'
  | 'math'
  | 'highlight'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'task';
