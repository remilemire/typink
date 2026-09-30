// Rasterizes Typst SVG pages to PNG/JPEG with Chromium, in a hidden window.

import { BrowserWindow } from 'electron';
import { splitTypstSvg, standalonePage } from '@shared/svgPages';

export interface RasterOptions {
  format: 'png' | 'jpeg';
  dpi: number;
  quality: number;
  background: string;
}

// Runs inside the hidden page (plain JS: the main process has no DOM types).
// Chromium caps canvases at 32,767 px a side and ~268 M pixels, so very long
// (endless) pages are scaled down to fit.
const RENDER_IN_PAGE = `async (svg, width, height, o) => {
  const scale = o.dpi / 72;
  let w = Math.round(width * scale);
  let h = Math.round(height * scale);
  const k = Math.min(1, 32000 / w, 32000 / h, Math.sqrt(260000000 / (w * h)));
  w = Math.floor(w * k);
  h = Math.floor(h * k);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('could not load page image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(o.format === 'jpeg' ? 'image/jpeg' : 'image/png', o.quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}`;

export async function rasterizePages(
  svg: string,
  pages: number[],
  options: RasterOptions,
  exactSizes: { w: number; h: number }[] = [],
): Promise<Buffer[]> {
  const split = splitTypstSvg(svg);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL('about:blank');
    const out: Buffer[] = [];
    for (const n of pages) {
      const page = split.pages[n - 1];
      if (!page) continue;
      const size = exactSizes[n - 1] ?? { w: page.width, h: page.height };
      const args = [standalonePage(split, n - 1, size), size.w, size.h, options].map((a) => JSON.stringify(a));
      const dataUrl: string = await win.webContents.executeJavaScript(`(${RENDER_IN_PAGE})(${args.join(',')})`);
      out.push(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    }
    return out;
  } finally {
    win.destroy();
  }
}
