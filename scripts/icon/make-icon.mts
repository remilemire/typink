// Typink's app icon, drawn in code: a sheet of ruled paper with typed lines and a
// handwritten loop in ink, outlined by the same code that draws Pencil ink in the app.
//
//   pnpm icon                                        write the icon into both apps
//   node scripts/icon/make-icon.mts --sheet <dir>    a preview sheet of every colourway instead
//
// Outputs:
// - apps/mac/build/icon.icon: an Icon Composer bundle (one colour per layer, so macOS can
//   restyle it for dark, clear and tinted icons). electron-builder compiles it with actool.
// - The iPad's AppIcon PNGs (light, dark, tinted) and accent colour, rendered from flat SVGs by
//   render.mjs in Electron. XcodeGen can't add .icon bundles to the project yet.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strokeOutline, type Sample } from '../../apps/mac/src/main/ink/outline.ts';

const root = path.resolve(import.meta.dirname, '../..');
const SIZE = 1024;

// ---- colours -------------------------------------------------------------------------

interface Palette {
  ink: string;
  inkDark: string;
}
const INKS: Record<string, Palette> = {
  coral: { ink: '#ff5a36', inkDark: '#ff8c70' },
  navy: { ink: '#15297a', inkDark: '#9dbcff' },
};
const CHOSEN_INK = 'coral';

const ACCENT = '#2f6fde'; // the app's accent colour
const ACCENT_DARK = '#6ea8ff';
const BG_TOP = '#5a93f2';
const BG_BOTTOM = '#2a64d4';
const DARK_BG_TOP = '#2c2f37';
const DARK_BG_BOTTOM = '#141519';
const PAPER = '#ffffff';
const PAPER_DARK = '#34363d';
const RULE = '#c7d5f2';
const RULE_DARK = '#4d5466';
const TYPED = '#2b2d33';
const TYPED_DARK = '#d3d6de';

// ---- geometry (paper-local coordinates, origin at the sheet's top-left) --------------

const SHEET = { w: 600, h: 740, r: 50, cx: 500, cy: 520, angle: -6 };
const MARGIN = 52;
const RULES = Array.from({ length: 9 }, (_, i) => 178 + i * 66);
const TYPED_LINES = [
  { rule: 0, w: 320, h: 32 }, // a heading
  { rule: 1, w: 460, h: 24 },
  { rule: 2, w: 380, h: 24 },
];
const sheetTransform = `translate(${SHEET.cx} ${SHEET.cy}) rotate(${SHEET.angle}) translate(${-SHEET.w / 2} ${-SHEET.h / 2})`;

const paperShape = () => `<rect width="${SHEET.w}" height="${SHEET.h}" rx="${SHEET.r}"/>`;
const ruleShapes = () =>
  RULES.map((y) => `<rect x="36" y="${y - 2.5}" width="${SHEET.w - 72}" height="5" rx="2.5"/>`).join('');
const typedShapes = () =>
  TYPED_LINES.map(({ rule, w, h }) => `<rect x="${MARGIN}" y="${RULES[rule] - 12 - h}" width="${w}" height="${h}" rx="${h / 2}"/>`).join('');

/** Three cursive loops written along rule 5, then a flourish off the edge of the sheet. */
function inkPath(weight = 1): string {
  const pts: [number, number][] = [];
  const x0 = 78;
  const y0 = RULES[5] - 4;
  const a = 21; // advance per radian
  const b = 52; // loop width
  const c = 64; // loop height / 2
  const loop = (t: number): [number, number] => [x0 + a * t - b * Math.sin(t), y0 - c * (1 + Math.cos(t))];
  // Lead-in: rising from below the line into the first loop.
  const [sx, sy] = loop(Math.PI);
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const p0 = [sx - 70, sy + 26];
    const p1 = [sx - 30, sy + 8];
    const x = (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * sx;
    const y = (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * sy;
    pts.push([x, y]);
  }
  for (let t = Math.PI; t <= 7 * Math.PI; t += 0.04) pts.push(loop(t));
  // Tail: along the line, then rising away past the sheet's right edge.
  const [ex, ey] = loop(7 * Math.PI);
  const c1 = [ex + 70, ey + 8];
  const c2 = [ex + 150, ey + 6];
  const end = [ex + 225, ey - 58];
  for (let i = 1; i <= 30; i++) {
    const u = i / 30;
    const k = (p: number[], j: number) =>
      (1 - u) ** 3 * [ex, ey][j] + 3 * (1 - u) ** 2 * u * c1[j] + 3 * (1 - u) * u * u * c2[j] + u ** 3 * p[j];
    pts.push([k(end, 0), k(end, 1)]);
  }
  // Pressure rises quickly and tapers at the end; a slanted nib thins the upstrokes.
  let total = 0;
  const lengths = pts.map((p, i) => (total += i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0));
  const nib = (35 * Math.PI) / 180;
  const widths = pts.map(([x, y], i) => {
    const s = lengths[i] / total;
    const pressure = Math.sin(Math.PI * Math.min(1, 0.12 + 0.92 * s ** 0.85)) ** 0.45;
    const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
    const [px, py] = pts[Math.max(0, i - 1)];
    const dir = Math.atan2(ny - py, nx - px);
    return (15 + 25 * pressure) * (0.64 + 0.36 * Math.abs(Math.sin(dir - nib)));
  });
  // Smooth the width like a real nib would, so the outline has no ripples.
  const smooth = widths.map((_, i) => {
    const window = widths.slice(Math.max(0, i - 4), i + 5);
    return window.reduce((sum, w) => sum + w, 0) / window.length;
  });
  const samples: Sample[] = pts.map(([x, y], i) => [x, y, smooth[i] * weight]);
  return strokeOutline(samples);
}

// ---- Icon Composer bundle (macOS) -----------------------------------------------------

const srgb = (hex: string) =>
  `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(6)).join(',')},1.000000`;
const extendedSrgb = (hex: string) =>
  `extended-srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;
const layerSvg = (body: string, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><g transform="${sheetTransform}" fill="${fill}">${body}</g></svg>\n`;
const darkFill = (hex: string) => [{ appearance: 'dark', value: { solid: srgb(hex) } }];

function writeIconBundle(dir: string, palette: Palette): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });
  const asset = (name: string, svg: string) => fs.writeFileSync(path.join(dir, 'Assets', name), svg);
  asset('paper.svg', layerSvg(paperShape(), PAPER));
  asset('rules.svg', layerSvg(ruleShapes(), RULE));
  asset('typed.svg', layerSvg(typedShapes(), TYPED));
  // Icon Composer draws filled shapes slightly thinner than Chromium does, so the Mac icon's
  // ink gets a heavier nib to match the iPad icon.
  asset('ink.svg', layerSvg(`<path d="${inkPath(1.35)}"/>`, palette.ink));
  const icon = {
    'fill-specializations': [
      { value: { 'automatic-gradient': extendedSrgb(ACCENT) } },
      { appearance: 'dark', value: 'system-dark' },
    ],
    // Front to back: the ink sits on top of the page.
    groups: [
      {
        layers: [{ 'image-name': 'ink.svg', name: 'Ink', 'fill-specializations': darkFill(palette.inkDark) }],
        shadow: { kind: 'layer-color', opacity: 0.4 },
        translucency: { enabled: false, value: 0 },
        // Ink is matte: a glass rim reads as white against the paper and thins the stroke.
        specular: false,
      },
      {
        layers: [
          { 'image-name': 'typed.svg', name: 'Typed lines', 'fill-specializations': darkFill(TYPED_DARK) },
          { 'image-name': 'rules.svg', name: 'Rules', 'fill-specializations': darkFill(RULE_DARK) },
          { 'image-name': 'paper.svg', name: 'Paper', 'fill-specializations': darkFill(PAPER_DARK) },
        ],
        shadow: { kind: 'neutral', opacity: 0.5 },
        translucency: { enabled: false, value: 0 },
        specular: false,
      },
    ],
    'supported-platforms': { squares: 'shared' },
  };
  fs.writeFileSync(path.join(dir, 'icon.json'), JSON.stringify(icon, null, 2) + '\n');
}

// ---- flat composites (iPad AppIcon, previews) -----------------------------------------

type Variant = 'light' | 'dark' | 'tinted';

/** One flat icon. `id` keeps gradient/filter ids unique when several are inlined in one SVG. */
function composite(variant: Variant, palette: Palette, opts: { background: boolean; id: string }): string {
  const c =
    variant === 'light'
      ? { paper: PAPER, rule: RULE, typed: TYPED, ink: palette.ink, top: BG_TOP, bottom: BG_BOTTOM }
      : variant === 'dark'
        ? { paper: PAPER_DARK, rule: RULE_DARK, typed: TYPED_DARK, ink: palette.inkDark, top: DARK_BG_TOP, bottom: DARK_BG_BOTTOM }
        : { paper: '#bdbdbd', rule: '#8a8a8a', typed: '#3d3d3d', ink: '#ffffff', top: '#1c1c1c', bottom: '#000000' };
  const id = opts.id;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.top}"/><stop offset="1" stop-color="${c.bottom}"/></linearGradient>
  <filter id="${id}shadow" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="20"/><feOffset dy="16"/>
    <feComponentTransfer><feFuncA type="linear" slope="${variant === 'light' ? 0.3 : 0.55}"/></feComponentTransfer>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="${id}inkshadow" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feOffset dy="5"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
${opts.background ? `<rect width="${SIZE}" height="${SIZE}" fill="url(#${id}bg)"/>` : ''}
<g transform="${sheetTransform}">
  <g filter="url(#${id}shadow)" fill="${c.paper}">${paperShape()}</g>
  <g fill="${c.rule}">${ruleShapes()}</g>
  <g fill="${c.typed}">${typedShapes()}</g>
  <g filter="url(#${id}inkshadow)"><path fill="${c.ink}" d="${inkPath()}"/></g>
</g>
</svg>
`;
}

interface Job {
  svg: string;
  png: string;
  width: number;
  height: number;
  opaque: boolean;
}

function writeIpadIcons(palette: Palette, jobs: Job[], tmp: string): void {
  const catalog = path.join(root, 'apps/ipad/Resources/Assets.xcassets');
  const iconSet = path.join(catalog, 'AppIcon.appiconset');
  fs.mkdirSync(iconSet, { recursive: true });
  const variants: [Variant, string, boolean][] = [
    ['light', 'AppIcon.png', true], // App Store Connect rejects an app icon with an alpha channel
    ['dark', 'AppIcon-Dark.png', false], // transparent: iPadOS puts its own dark backdrop behind it
    ['tinted', 'AppIcon-Tinted.png', false],
  ];
  for (const [variant, file, opaque] of variants) {
    const svg = path.join(tmp, `ipad-${variant}.svg`);
    fs.writeFileSync(svg, composite(variant, palette, { background: variant === 'light', id: variant }));
    jobs.push({ svg, png: path.join(iconSet, file), width: SIZE, height: SIZE, opaque });
  }
  const image = (file: string, appearance?: string) => ({
    ...(appearance ? { appearances: [{ appearance: 'luminosity', value: appearance }] } : {}),
    filename: file,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  });
  const info = { author: 'xcode', version: 1 };
  fs.writeFileSync(path.join(catalog, 'Contents.json'), JSON.stringify({ info }, null, 2) + '\n');
  fs.writeFileSync(
    path.join(iconSet, 'Contents.json'),
    JSON.stringify({ images: [image('AppIcon.png'), image('AppIcon-Dark.png', 'dark'), image('AppIcon-Tinted.png', 'tinted')], info }, null, 2) + '\n',
  );
  const accent = path.join(catalog, 'AccentColor.colorset');
  fs.mkdirSync(accent, { recursive: true });
  const color = (hex: string) => ({
    'color-space': 'srgb',
    components: {
      alpha: '1.000',
      red: `0x${hex.slice(1, 3).toUpperCase()}`,
      green: `0x${hex.slice(3, 5).toUpperCase()}`,
      blue: `0x${hex.slice(5, 7).toUpperCase()}`,
    },
  });
  fs.writeFileSync(
    path.join(accent, 'Contents.json'),
    JSON.stringify(
      {
        colors: [
          { color: color(ACCENT), idiom: 'universal' },
          { appearances: [{ appearance: 'luminosity', value: 'dark' }], color: color(ACCENT_DARK), idiom: 'universal' },
        ],
        info,
      },
      null,
      2,
    ) + '\n',
  );
}

/** Every colourway, light and dark, from Dock size down to a list row, masked like the system does. */
function writeSheet(dir: string, jobs: Job[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const sizes = [256, 128, 64, 32];
  const cell = (x: number, y: number, s: number, svg: string) =>
    `<g transform="translate(${x} ${y})"><clipPath id="m${x}_${y}"><rect width="${s}" height="${s}" rx="${s * 0.2237}"/></clipPath>` +
    `<g clip-path="url(#m${x}_${y})"><svg width="${s}" height="${s}" viewBox="0 0 ${SIZE} ${SIZE}">${svg.replace(/<\/?svg[^>]*>/g, '')}</svg></g></g>`;
  let body = '';
  let y = 40;
  for (const [name, palette] of Object.entries(INKS)) {
    for (const variant of ['light', 'dark'] as const) {
      let x = 40;
      body += `<text x="40" y="${y - 12}" font-family="-apple-system, Helvetica" font-size="18" fill="#555">${name} · ${variant}</text>`;
      for (const s of sizes) {
        const svg = composite(variant, palette, { background: true, id: `${name}${variant}${s}` });
        body += cell(x, y, s, svg);
        x += s + 36;
      }
      y += 256 + 60;
    }
  }
  const width = 40 + sizes.reduce((a, s) => a + s + 36, 0);
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}"><rect width="100%" height="100%" fill="#ececea"/>${body}</svg>\n`;
  fs.writeFileSync(path.join(dir, 'sheet.svg'), sheet);
  jobs.push({ svg: path.join(dir, 'sheet.svg'), png: path.join(dir, 'sheet.png'), width, height: y, opaque: true });
  for (const [name, palette] of Object.entries(INKS)) {
    writeIconBundle(path.join(dir, `${name}.icon`), palette);
    const big = path.join(dir, `${name}-1024.svg`);
    fs.writeFileSync(big, composite('light', palette, { background: true, id: name }));
    jobs.push({ svg: big, png: path.join(dir, `${name}-1024.png`), width: SIZE, height: SIZE, opaque: true });
  }
}

// ---- main ----------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const jobs: Job[] = [];
const jobsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'typink-icon-')), 'jobs.json');
const sheetDir = flag('sheet');
if (sheetDir) {
  writeSheet(path.resolve(sheetDir), jobs);
} else {
  const palette = INKS[flag('ink') ?? CHOSEN_INK];
  if (!palette) throw new Error(`Unknown ink. Pick one of: ${Object.keys(INKS).join(', ')}`);
  writeIconBundle(path.join(root, 'apps/mac/build/icon.icon'), palette);
  writeIpadIcons(palette, jobs, path.dirname(jobsFile));
}
fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2));
const electron = path.join(root, 'apps/mac/node_modules/.bin/electron');
execFileSync(electron, [path.join(import.meta.dirname, 'render.mjs'), jobsFile], { stdio: 'inherit' });
fs.rmSync(path.dirname(jobsFile), { recursive: true, force: true });
