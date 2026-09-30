// File ▸ Export: PDF straight from Typst; PNG/JPEG by rasterizing Typst's SVG pages.

import fs from 'node:fs';
import path from 'node:path';
import { app as electronApp, dialog } from 'electron';
import type { ExportResult } from '@shared/api';
import type { ExportOptions } from '@shared/types';
import type { Typink } from '../typink';
import { exactPageSizes } from '../compile/service';
import { rasterizePages } from './raster';

export async function exportNote(app: Typink, rel: string, options: ExportOptions): Promise<ExportResult | null> {
  const name = path.basename(rel, '.typ');
  const ext = options.format === 'jpeg' ? 'jpg' : options.format;
  // TYPINK_EXPORT_DIR skips the save panel (end-to-end tests).
  const res = process.env.TYPINK_EXPORT_DIR
    ? { canceled: false, filePath: path.join(process.env.TYPINK_EXPORT_DIR, `${name}.${ext}`) }
    : await dialog.showSaveDialog(app.window!, {
        title: `Export “${name}”`,
        defaultPath: path.join(electronApp.getPath('downloads'), `${name}.${ext}`),
        filters: [{ name: options.format.toUpperCase(), extensions: [ext] }],
      });
  if (res.canceled || !res.filePath) return null;

  const ann = options.annotations && (await app.prepareAnnotationExport(rel)) ? 'on' : 'off';
  const inputs = { theme: options.theme, ann };

  if (options.format === 'pdf') {
    const out = await app.compiler.compile(rel, inputs, { pdf: true });
    if (!out.ok || !out.pdf) throw new Error(firstError(out.diagnostics));
    fs.writeFileSync(res.filePath, out.pdf);
    return { files: [res.filePath] };
  }

  const out = await app.compiler.compile(rel, inputs, { svg: true, query: true });
  if (!out.ok || !out.svg) throw new Error(firstError(out.diagnostics));
  const pages = selectPages(out.pageCount, options);
  const images = await rasterizePages(
    out.svg,
    pages,
    {
      format: options.format,
      dpi: options.dpi,
      quality: options.quality,
      background: options.theme === 'dark' ? '#1c1c1e' : '#ffffff',
    },
    exactPageSizes(out) ?? [],
  );
  const files: string[] = [];
  const base = res.filePath.replace(/\.(png|jpe?g)$/i, '');
  images.forEach((data, i) => {
    const file = images.length === 1 ? `${base}.${ext}` : `${base}-p${pages[i]}.${ext}`;
    fs.writeFileSync(file, data);
    files.push(file);
  });
  return { files };
}

function selectPages(count: number, options: ExportOptions): number[] {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if (options.pages === 'all') return all;
  if (options.pages === 'current') return [Math.min(Math.max(1, options.currentPage), count)];
  const { from, to } = options.pages;
  return all.filter((p) => p >= from && p <= to);
}

function firstError(diagnostics: { severity: string; message: string }[]): string {
  const error = diagnostics.find((d) => d.severity === 'error');
  return error ? `Typst error: ${error.message}` : 'The note could not be compiled';
}
