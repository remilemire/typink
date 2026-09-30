// End-to-end check of the Mac app, driven by Playwright, with scripts/fake-ipad.mts
// standing in for the iPad. Uses throwaway settings/notes folders.
//
//   pnpm --filter @typink/mac e2e

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { FakeIpad } from '../scripts/fake-ipad.mts';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('@playwright/test') as typeof import('@playwright/test');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'typink-e2e-'));
const dirs = { userData: path.join(tmp, 'userdata'), library: path.join(tmp, 'library'), exports: path.join(tmp, 'exports') };
fs.mkdirSync(dirs.userData, { recursive: true });
fs.mkdirSync(dirs.exports, { recursive: true });
fs.writeFileSync(path.join(dirs.userData, 'settings.json'), JSON.stringify({ settings: { appearance: 'light' } }));
const port = 47300 + Math.floor(Math.random() * 90);

let step = 0;
const ok = (message: string) => console.log(`  ✓ ${++step}. ${message}`);

const app = await electron.launch({
  args: [path.join(path.dirname(new URL(import.meta.url).pathname), '..')],
  env: {
    ...process.env,
    TYPINK_USER_DATA: dirs.userData,
    TYPINK_LIBRARY: dirs.library,
    TYPINK_PORT: String(port),
    TYPINK_EXPORT_DIR: dirs.exports,
  },
});
const win = await app.firstWindow();
const errors: string[] = [];
win.on('pageerror', (e) => errors.push(e.message));
const note = path.join(dirs.library, 'Notes', 'Welcome.typ');
const saved = () => fs.readFileSync(note, 'utf8');
const exportNote = (options: Record<string, unknown>) =>
  win.evaluate(
    (o) => window.typink.exportNote('Notes/Welcome.typ', o as never),
    { theme: 'light', annotations: false, dpi: 144, quality: 0.9, pages: 'all', currentPage: 1, ...options },
  );

try {
  await win.setViewportSize({ width: 1400, height: 880 });
  await win.waitForSelector('.page svg', { timeout: 30_000 });
  ok('first launch creates the welcome note and renders it');

  await win.click('.cm-line >> nth=-1');
  await win.keyboard.press('Meta+ArrowDown');
  await win.keyboard.type('\n\n== Typed by the test\nSome *bold* words and $x^2$.\n');
  await win.keyboard.type('/tas');
  await win.waitForSelector('.cm-tooltip-autocomplete');
  await win.keyboard.press('Enter');
  await win.keyboard.type('Buy more paper');
  await win.waitForTimeout(1200);
  assert.match(saved(), /#task\[Buy more paper\]/);
  ok('typing and the / menu autosave to the .typ file');

  await win.click('button[title="Grid paper"]');
  await win.waitForTimeout(1200);
  assert.match(saved().split('\n')[1], /template: "grid"/);
  ok('the paper picker rewrites the note header');

  for (const format of ['pdf', 'png', 'jpeg']) {
    const res = await exportNote({ format });
    assert.equal(res?.files.length, 1);
    assert.ok(fs.statSync(res!.files[0]).size > 10_000, `${format} export is not empty`);
  }
  const png = fs.readFileSync(path.join(dirs.exports, 'Welcome.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1191, 1684]); // A4 (595.28 × 841.89 pt) at 144 dpi
  ok('exports PDF, PNG (A4 at 144 dpi) and JPEG');

  // ---- the iPad -------------------------------------------------------------------
  const status = await win.evaluate(() => window.typink.hubStatus());
  assert.equal(status.error, null);
  const ipad = new FakeIpad({ port, code: status.pairingCode, stateFile: path.join(tmp, 'fake-ipad.json'), log: () => {} });
  await ipad.connect();
  const info = await ipad.next((m) => m.t === 'note');
  const pdf = await ipad.next((m) => m.t === 'pdf');
  assert.ok(pdf.payloadBytes > 10_000);
  const devices = await win.evaluate(() => window.typink.hubStatus());
  assert.equal(devices.devices.filter((d) => d.connected).length, 1);
  ok(`the iPad pairs with code ${status.pairingCode} and receives the note as a PDF`);

  const sketch = await ipad.drawSketch();
  await win.waitForTimeout(1500);
  const manifest = JSON.parse(fs.readFileSync(path.join(dirs.library, '.typink', 'manifest.json'), 'utf8'));
  assert.equal(manifest.ink[sketch.id].n, 2);
  for (const ext of ['.svg', '.dark.svg', '.json', '.pkdrawing']) {
    assert.ok(fs.existsSync(path.join(dirs.library, '.typink', 'ink', sketch.id + ext)), ext);
  }
  assert.match(saved(), new RegExp(`#sketch\\("${sketch.id}"\\)`));
  assert.ok(await win.locator(`.sketch-widget img[src*="${sketch.id}"]`).count());
  ok('a sketch drawn on the iPad lands at the cursor, in the preview and as a thumbnail');

  await ipad.annotate(info.note, info.rev, [60, 150, 200, 40]);
  await win.waitForSelector('.annotation-layer img');
  const topBefore = parseFloat(await win.locator('.annotation-layer img').first().evaluate((el) => (el as HTMLElement).style.top));
  await win.click('.cm-line >> nth=0');
  await win.keyboard.press('Meta+ArrowUp');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.type('Pushed down one.\n\nPushed down two.\n\n');
  await win.waitForTimeout(1500);
  const topAfter = parseFloat(await win.locator('.annotation-layer img').first().evaluate((el) => (el as HTMLElement).style.top));
  assert.ok(topAfter > topBefore + 20, `annotation moved from ${topBefore} to ${topAfter}`);
  ok('handwriting over the text follows its paragraph when text is inserted above');

  const withInk = await exportNote({ format: 'pdf', annotations: true });
  assert.ok(withInk?.files[0]);
  assert.ok(fs.existsSync(path.join(dirs.library, '.typink', 'ann', 'welcome.place.json')));
  ok('exports bake the handwriting in');

  const photo = path.join(tmp, 'photo.png');
  fs.writeFileSync(
    photo,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  );
  await ipad.sendPhoto(photo, 'insert');
  await win.waitForTimeout(1200);
  assert.match(saved(), /#figure\(image\("\/attachments\/[0-9a-f]{12}\.png", width: 80%\)\)/);
  ok('a photo sent from the iPad is stored in attachments/ and inserted');

  // A repeating failure in the background (an unreachable network) once stacked modal dialogs.
  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('Simulated background failure');
    }, 0);
  });
  await win.waitForSelector('text=Something went wrong: Simulated background failure', { timeout: 5000 });
  await win.click('.cm-content');
  await win.keyboard.press('Meta+ArrowDown');
  await win.keyboard.type('\nStill responsive.');
  await win.waitForTimeout(1200);
  assert.match(saved(), /Still responsive\./);
  ok('an error in the main process shows a toast instead of a dialog, and the app keeps working');

  ipad.close();
  assert.deepEqual(errors, []);
  ok('no renderer errors');
  console.log(`\nAll ${step} end-to-end checks passed.`);
} catch (err) {
  await win.screenshot({ path: path.join(tmp, 'failure.png') }).catch(() => {});
  console.error(`\n✗ Step ${step + 1} failed (screenshot in ${tmp}):`, err);
  process.exitCode = 1;
} finally {
  await app.close();
}
