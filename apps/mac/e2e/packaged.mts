// Smoke test for the packaged app (release/mac-arm64/Typink.app), run before every release:
//
//   pnpm --filter @typink/mac dist && pnpm --filter @typink/mac smoke
//
// The e2e suite drives the development build, where fuses, asar integrity and the hardened
// runtime don't apply. This launches the real bundle against throwaway folders, pairs a fake
// iPad and waits for a compiled note, which proves the Typst compiler still loads and runs
// inside the locked-down app. It also checks that quitting withdraws the Bonjour service.

import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeIpad } from '../scripts/fake-ipad.mts';

const appDir = path.resolve(import.meta.dirname, '..');
const bundle = process.argv[2] ?? path.join(appDir, 'release/mac-arm64/Typink.app');
const binary = path.join(bundle, 'Contents/MacOS/Typink');
assert.ok(fs.existsSync(binary), `No packaged app at ${bundle}. Run pnpm --filter @typink/mac dist first.`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'typink-smoke-'));
const port = 47400 + Math.floor(Math.random() * 90);
const hostname = () => execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
const advertisers = () => {
  try {
    return execFileSync('pgrep', ['-f', `dns-sd -R .* ${port}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

let step = 0;
const ok = (message: string) => console.log(`  ✓ ${++step}. ${message}`);
const nameBefore = hostname();
let app: ChildProcess | null = null;
let output = '';

try {
  app = spawn(binary, [], {
    env: {
      ...process.env,
      TYPINK_USER_DATA: path.join(tmp, 'userData'),
      TYPINK_LIBRARY: path.join(tmp, 'library'),
      TYPINK_PORT: String(port),
      TYPINK_LOG_PAIRING: '1',
    },
  });
  app.stdout?.on('data', (chunk) => (output += chunk));
  app.stderr?.on('data', (chunk) => (output += chunk));

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The app didn't start. Its output:\n${output}`)), 30_000);
    const poll = setInterval(() => {
      const match = /pairing code (\d{6})/.exec(output);
      if (match) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(match[1]);
      }
    }, 100);
  });
  ok('the packaged app starts and its iPad hub listens');

  const ipad = new FakeIpad({ port, code, stateFile: path.join(tmp, 'fake-ipad.json'), log: () => {} });
  await ipad.connect();
  // The release build compiles fast enough that the note can arrive while connect() is finishing.
  const first = (t: string) => ipad.received.find((m) => m.t === t) ?? ipad.next((m) => m.t === t, 30_000);
  const note = await first('note');
  const pdf = await first('pdf');
  assert.ok(Array.isArray(note.pages) && (note.pages as unknown[]).length > 0);
  assert.equal(pdf.note, note.note);
  ipad.close();
  ok('a fake iPad pairs and receives the welcome note, compiled by Typst inside the bundle');

  assert.ok(advertisers(), 'dns-sd should be advertising the hub');
  const logFile = path.join(tmp, 'userData/logs/main.log');
  assert.match(fs.readFileSync(logFile, 'utf8'), /Typink \d+\.\d+\.\d+ \(release\)/);
  ok('the hub is advertised through dns-sd, and main.log is written');

  app.kill('SIGTERM');
  await new Promise((resolve) => app!.once('exit', resolve));
  app = null;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(advertisers(), '', 'quitting should withdraw the Bonjour service');
  assert.equal(hostname(), nameBefore, "the Mac's local hostname must not change");
  ok("quitting withdraws the Bonjour service, and the Mac's hostname is untouched");

  console.log(`\nAll ${step} packaged-app checks passed.`);
} catch (err) {
  console.error(`\n✗ Check ${step + 1} failed:`, err);
  console.error(`\nThe app's output:\n${output.split('\n').slice(-40).join('\n')}`);
  process.exitCode = 1;
} finally {
  app?.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
}
