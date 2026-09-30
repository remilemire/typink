// Sets the version of both apps, and moves the shared build number forward.
//
//   pnpm bump 1.2.0              # or: patch | minor | major
//   pnpm bump patch --dry-run    # show what would change
//
// The version (1.2.0) goes to apps/mac/package.json and to MARKETING_VERSION in
// apps/ipad/project.yml. The build number goes to CURRENT_PROJECT_VERSION (TestFlight
// requires it to keep increasing) and to electron-builder's buildVersion (the Mac's
// CFBundleVersion). Files are edited line by line so their comments survive.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = {
  macPackage: path.join(root, 'apps/mac/package.json'),
  macBuilder: path.join(root, 'apps/mac/electron-builder.yml'),
  ipadProject: path.join(root, 'apps/ipad/project.yml'),
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));
if (!target) fail('Usage: pnpm bump <x.y.z | patch | minor | major> [--dry-run]');

const read = (file: string) => fs.readFileSync(file, 'utf8');
const match = (text: string, re: RegExp, what: string) => {
  const m = re.exec(text);
  if (!m) return fail(`Couldn't find ${what}`);
  return m;
};

const pkg = read(files.macPackage);
const builder = read(files.macBuilder);
const project = read(files.ipadProject);

const current = match(pkg, /"version": "(\d+)\.(\d+)\.(\d+)"/, 'the version in apps/mac/package.json').slice(1).map(Number);
const next = (() => {
  const [major, minor, patch] = current;
  if (target === 'major') return [major + 1, 0, 0];
  if (target === 'minor') return [major, minor + 1, 0];
  if (target === 'patch') return [major, minor, patch + 1];
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(target);
  if (!m) return fail(`"${target}" isn't a version like 1.2.0, or patch/minor/major.`);
  return m.slice(1).map(Number);
})();
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
if (compare(next, current) < 0) fail(`${next.join('.')} is older than the current ${current.join('.')}.`);

const ipadBuild = Number(match(project, /CURRENT_PROJECT_VERSION: "(\d+)"/, 'CURRENT_PROJECT_VERSION in project.yml')[1]);
const macBuild = Number(match(builder, /^buildVersion: "(\d+)"/m, 'buildVersion in electron-builder.yml')[1]);
const build = Math.max(ipadBuild, macBuild) + 1;
const version = next.join('.');

const updates: [string, string][] = [
  [files.macPackage, pkg.replace(/"version": "[^"]+"/, `"version": "${version}"`)],
  [files.macBuilder, builder.replace(/^buildVersion: "\d+"/m, `buildVersion: "${build}"`)],
  [
    files.ipadProject,
    project
      .replace(/MARKETING_VERSION: [\d.]+/, `MARKETING_VERSION: ${version}`)
      .replace(/CURRENT_PROJECT_VERSION: "\d+"/, `CURRENT_PROJECT_VERSION: "${build}"`),
  ],
];

console.log(`Typink ${current.join('.')} → ${version} (build ${build})${dryRun ? ', dry run' : ''}`);
for (const [file, text] of updates) {
  console.log(`  ${path.relative(root, file)}`);
  if (!dryRun) fs.writeFileSync(file, text);
}
