// Builds, signs, notarizes and publishes the Mac app as a draft GitHub release.
//
//   pnpm release:mac                  # from a clean `main`, after `pnpm bump …`
//   pnpm release:mac --skip-tests     # when the same commit just passed them
//
// Needs a "Developer ID Application" certificate in your keychain and notarization
// credentials stored with `xcrun notarytool store-credentials typink-notary …`
// (see docs/releasing.md). The release stays a draft until you publish it, so you can
// download and try the DMG first; auto-update only sees published releases.

import { execFileSync, type ExecFileSyncOptions, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const macDir = path.join(root, 'apps/mac');
const release = path.join(macDir, 'release');
const profile = process.env.APPLE_KEYCHAIN_PROFILE ?? 'typink-notary';
const skipTests = process.argv.includes('--skip-tests');

const run = (cmd: string, args: string[], opts: ExecFileSyncOptions = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const output = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
const step = (title: string) => console.log(`\n▸ ${title}`);
function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(macDir, 'package.json'), 'utf8')).version as string;
const tag = `v${version}`;

step(`Typink ${version}: checking everything is ready`);
if (output('git', ['status', '--porcelain'])) fail('Commit or stash your changes first.');
if (output('git', ['branch', '--show-current']) !== 'main') fail('Release from `main` (merge `dev` into it first).');
if (output('git', ['tag', '--list', tag])) fail(`${tag} already exists. Run \`pnpm bump patch\` (or minor/major) first.`);
if (!output('security', ['find-identity', '-v', '-p', 'codesigning']).includes('Developer ID Application')) {
  fail('No "Developer ID Application" certificate in your keychain. See docs/releasing.md › One-time setup.');
}
try {
  output('gh', ['auth', 'status']);
} catch {
  fail('The GitHub CLI isn\'t signed in (`gh auth login`).');
}

if (!skipTests) {
  step('Tests');
  run('pnpm', ['typecheck']);
  run('pnpm', ['test']);
  run('pnpm', ['--filter', '@typink/mac', 'e2e']);
}

step('Building, signing and notarizing the app (a few minutes)');
fs.rmSync(release, { recursive: true, force: true });
run('pnpm', ['--filter', '@typink/mac', 'build']);
run('pnpm', ['exec', 'electron-builder', '--mac', '--publish', 'never', '-c.forceCodeSigning=true'], {
  cwd: macDir,
  env: { ...process.env, APPLE_KEYCHAIN_PROFILE: profile },
});

const app = path.join(release, 'mac-arm64/Typink.app');
const dmg = path.join(release, 'Typink-arm64.dmg');
const zip = path.join(release, `Typink-${version}-arm64.zip`);
const updateInfo = path.join(release, 'latest-mac.yml');
for (const file of [app, dmg, zip, `${zip}.blockmap`, updateInfo]) {
  if (!fs.existsSync(file)) fail(`electron-builder didn't produce ${path.relative(root, file)}`);
}

step('Notarizing and stapling the DMG');
run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait']);
run('xcrun', ['stapler', 'staple', dmg]);

step('Checking the result the way Gatekeeper will');
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
// spctl prints its verdict on stderr.
const verdict = spawnSync('spctl', ['--assess', '--verbose=4', '--type', 'execute', app], { encoding: 'utf8' });
const assessment = `${verdict.stdout}${verdict.stderr}`.trim();
console.log(assessment);
if (verdict.status !== 0 || !assessment.includes('Notarized Developer ID')) fail('Gatekeeper doesn\'t accept the app as notarized.');
run('xcrun', ['stapler', 'validate', app]);
run('xcrun', ['stapler', 'validate', dmg]);
run('spctl', ['--assess', '--verbose=2', '--type', 'open', '--context', 'context:primary-signature', dmg]);

step('Smoke test of the signed app');
run('node', ['--no-warnings', 'e2e/packaged.mts', app], { cwd: macDir });

step(`Tagging ${tag} and creating a draft GitHub release`);
run('git', ['tag', '-a', tag, '-m', `Typink ${version}`]);
run('git', ['push', 'origin', tag]);
run('gh', [
  'release', 'create', tag,
  '--repo', 'remilemire/typink',
  '--title', `Typink ${version}`,
  '--generate-notes',
  '--draft',
  dmg, zip, `${zip}.blockmap`, updateInfo,
]);

console.log(`
✓ Typink ${version} is a draft release: https://github.com/remilemire/typink/releases
  1. Download the DMG from the draft in Safari, install it, and open it (it should open without warnings).
  2. Publish it: gh release edit ${tag} --repo remilemire/typink --draft=false
     Installed copies pick it up within six hours, or at once via Typink › Check for Updates…`);
