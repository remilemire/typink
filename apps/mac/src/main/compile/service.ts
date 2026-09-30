// Debounced, latest-wins compilation for the live preview, plus one-off
// compiles for exports and the iPad.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { splitTypstSvg } from '@shared/svgPages';
import type { BlockAnchor, Diagnostic, LayoutInfo, PageSize, PaperTheme, PreviewResult, SketchPlacement } from '@shared/types';
import type { CompileHost } from './host';
import type { CompileOutputs, EngineCompileResult, EngineDiagnostic } from './protocol';

interface PendingPreview {
  source?: string;
  theme: PaperTheme;
  timer: NodeJS.Timeout | null;
}

export interface PreviewContext {
  root: string;
}

type Events = { preview: [PreviewResult] };

export class CompileService extends EventEmitter<Events> {
  private pending = new Map<string, PendingPreview>();
  private inFlight = new Set<string>();
  private revs = new Map<string, number>();
  private latest = new Map<string, PreviewResult>();

  constructor(
    private readonly host: CompileHost,
    private readonly getRoot: () => string,
  ) {
    super();
  }

  /** Schedules a preview compile; rapid calls for the same note collapse into one. */
  requestPreview(notePath: string, theme: PaperTheme, source?: string, delayMs = 120): void {
    const existing = this.pending.get(notePath);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry: PendingPreview = {
      // Keep the newest buffer; a request without source (e.g. ink changed) reuses the overlay.
      source: source ?? existing?.source,
      theme,
      timer: null,
    };
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.runPreview(notePath);
    }, delayMs);
    this.pending.set(notePath, entry);
  }

  /** The most recent preview result for a note, if any. */
  latestPreview(notePath: string): PreviewResult | undefined {
    return this.latest.get(notePath);
  }

  /** Stops overriding the file on disk with editor text (call after closing a note). */
  async release(notePath: string): Promise<void> {
    await this.host.unmap(this.abs(notePath));
  }

  /** A one-off compile (exports, iPad PDFs). Uses whatever text the compiler already has for the note. */
  async compile(notePath: string, inputs: Record<string, string>, outputs: CompileOutputs): Promise<EngineCompileResult> {
    return this.host.compile({ type: 'compile', path: this.abs(notePath), inputs, outputs });
  }

  toPreview(notePath: string, rev: number, theme: PaperTheme, raw: EngineCompileResult): PreviewResult {
    const svg = raw.svg;
    return {
      notePath,
      rev,
      theme,
      ok: raw.ok,
      svg,
      pages: exactPageSizes(raw) ?? (svg ? pageSizes(svg) : []),
      diagnostics: raw.diagnostics.map((d) => this.diagnostic(d)),
      sketches: (raw.sketches ?? []).map(toSketch).filter((s): s is SketchPlacement => s !== null),
      blocks: toBlocks(raw.blocks ?? []),
      layout: toLayout(raw.layout),
      annotations: [],
      ms: Math.round(raw.ms),
    };
  }

  private async runPreview(notePath: string): Promise<void> {
    if (this.inFlight.has(notePath)) return; // re-run when the current compile finishes
    const entry = this.pending.get(notePath);
    if (!entry || entry.timer) return;
    this.pending.delete(notePath);
    this.inFlight.add(notePath);
    const rev = (this.revs.get(notePath) ?? 0) + 1;
    this.revs.set(notePath, rev);
    try {
      const raw = await this.host.compile({
        type: 'compile',
        path: this.abs(notePath),
        source: entry.source,
        inputs: { theme: entry.theme, preview: '1' },
        outputs: { svg: true, query: true },
      });
      const result = this.toPreview(notePath, rev, entry.theme, raw);
      this.latest.set(notePath, result);
      this.emit('preview', result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('preview', {
        notePath,
        rev,
        theme: entry.theme,
        ok: false,
        pages: [],
        diagnostics: [{ severity: 'error', message, path: notePath, range: null }],
        sketches: [],
        blocks: [],
        layout: null,
        annotations: [],
        ms: 0,
      });
    } finally {
      this.inFlight.delete(notePath);
      const next = this.pending.get(notePath);
      if (next && !next.timer) void this.runPreview(notePath);
    }
  }

  private abs(notePath: string): string {
    return path.join(this.getRoot(), notePath);
  }

  private diagnostic(d: EngineDiagnostic): Diagnostic {
    const root = this.getRoot();
    let rel = d.path;
    if (rel && rel.startsWith(root)) rel = path.relative(root, rel).split(path.sep).join('/');
    return { severity: d.severity, message: d.message, path: rel, range: d.range };
  }
}

// ---- raw metadata → typed results ---------------------------------------------------

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Page sizes reported by lib.typ, or null for plain Typst files. */
export function exactPageSizes(raw: EngineCompileResult): PageSize[] | null {
  const sizes = (raw.pages ?? [])
    .map((v) => v as Record<string, unknown>)
    .filter((v) => typeof v?.w === 'number' && typeof v?.h === 'number')
    .sort((a, b) => num(a.page) - num(b.page))
    .map((v) => ({ w: num(v.w), h: num(v.h) }));
  return sizes.length > 0 && sizes.length === raw.pageCount ? sizes : null;
}

export function pageSizes(svg: string): PageSize[] {
  return splitTypstSvg(svg).pages.map((p) => ({ w: p.width, h: p.height }));
}

function toSketch(v: unknown): SketchPlacement | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    page: num(o.page, 1),
    x: num(o.x),
    y: num(o.y),
    w: num(o.w),
    h: num(o.h),
    on: typeof o.on === 'string' ? o.on : null,
    onPage: typeof o['on-page'] === 'number' ? o['on-page'] : null,
  };
}

export function toBlocks(pages: unknown[][]): BlockAnchor[] {
  const out: BlockAnchor[] = [];
  pages.forEach((blocks, i) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== 'object') continue;
      const o = b as Record<string, unknown>;
      out.push({
        page: i + 1,
        kind: String(o.k ?? ''),
        x: num(o.x),
        y: num(o.y),
        text: typeof o.t === 'string' ? o.t : '',
        src: typeof o.src === 'string' ? o.src : null,
      });
    }
  });
  return out;
}

function toLayout(v: unknown): LayoutInfo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    template: (o.template as LayoutInfo['template']) ?? 'blank',
    ruled: o.ruled === true,
    pitch: num(o.pitch, 16),
    originX: num(o['origin-x']),
    originY: num(o['origin-y']),
    pageWidth: num(o['page-w'], 595.28),
    marginX: num(o['margin-x']),
  };
}
