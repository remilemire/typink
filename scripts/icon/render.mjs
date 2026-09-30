// Rasterizes SVGs to PNGs with Chromium, for the icon pipeline (see make-icon.mts).
//
//   electron scripts/icon/render.mjs <jobs.json>
//
// Each job is { svg, png, width, height, opaque }. Opaque jobs are written as RGB PNGs
// without an alpha channel, which App Store Connect requires for the app icon.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { app, BrowserWindow } from 'electron';

const jobs = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'typink-render-')));
app.dock?.hide();

/** Runs in the page: draws the SVG onto a canvas and returns its RGBA pixels as base64. */
const RENDER_IN_PAGE = `(svg, width, height) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const bytes = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    resolve(btoa(binary));
  };
  img.onerror = () => reject(new Error('The SVG could not be loaded'));
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
})`;

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, width, height, opaque) {
  const channels = opaque ? 3 : 4;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * stride + 1 + x * channels;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
      if (!opaque) raw[to + 3] = rgba[from + 3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = opaque ? 2 : 6; // RGB or RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    await win.loadURL('data:text/html,<meta charset="utf-8">');
    for (const job of jobs) {
      const svg = fs.readFileSync(job.svg, 'utf8');
      const base64 = await win.webContents.executeJavaScript(
        `(${RENDER_IN_PAGE})(${JSON.stringify(svg)}, ${job.width}, ${job.height})`,
      );
      fs.mkdirSync(path.dirname(job.png), { recursive: true });
      fs.writeFileSync(job.png, encodePng(Buffer.from(base64, 'base64'), job.width, job.height, job.opaque));
      console.log(`wrote ${path.relative(process.cwd(), job.png)} (${job.width}×${job.height}${job.opaque ? ', no alpha' : ''})`);
    }
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
