// The iPad hub: a WebSocket server on the local network, advertised over
// Bonjour. Paired iPads see the note as a live PDF, draw sketches and
// annotations, and send photos.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import {
  decodeFrame,
  encodeFrame,
  type FromPad,
  fromPad,
  packParts,
  part,
  PROTOCOL_VERSION,
  type Ruling,
  type ToPad,
} from '@typink/protocol';
import type { BlockAnchor, HubStatus, LayoutInfo, PaperTheme, SketchPlacement } from '@shared/types';
import { readPencilKitData, resizeSketch, saveSketch } from '../ink/sketches';
import type { Typink } from '../typink';
import { Pairing } from './pairing';

const PDF_MIN_INTERVAL_MS = 900;
const PING_INTERVAL_MS = 15_000;
/**
 * Runs `dns-sd -R <args>` until our end of its stdin closes (on quit, and also when the app
 * crashes), then withdraws the service. Exits by itself if dns-sd does.
 */
const ADVERTISE_SCRIPT = [
  'exec 3<&0',
  '/usr/bin/dns-sd -R "$@" >/dev/null & pid=$!',
  '(read -r _ <&3; kill $pid 2>/dev/null) & watchdog=$!',
  'wait $pid',
  'kill $watchdog 2>/dev/null',
].join('\n');
/** Layout revisions count up from the clock, so they keep increasing across restarts and a
 *  `viewedRev` from before one never names a different layout. */
const REV_BASE = Date.now();

interface Session {
  ws: WebSocket;
  alive: boolean;
  deviceId: string | null;
  name: string;
  authed: boolean;
  theme: PaperTheme;
  /** Note shown on the iPad; null follows the note open on the Mac. */
  view: string | null;
  lastActive: number;
  pdf: { timer: NodeJS.Timeout | null; busy: boolean; dirty: boolean; lastAt: number };
}

export interface NoteSnapshot {
  rev: number;
  blocks: BlockAnchor[];
  layout: LayoutInfo | null;
  sketches: SketchPlacement[];
}

export class Hub {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private advertiser: ChildProcess | null = null;
  private stopped = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly sessions = new Set<Session>();
  private readonly pairing: Pairing;
  private error: string | null = null;
  private port = 0;
  readonly macName = computerName();
  /** Layout snapshots per note, by the revision number sent to iPads (for anchoring annotations). */
  private readonly snapshots = new Map<string, NoteSnapshot[]>();
  private readonly revs = new Map<string, number>();

  constructor(private readonly app: Typink) {
    this.pairing = new Pairing(app.settings);
  }

  start(): void {
    this.port = this.app.settings.settings.hubPort;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Typink\n');
    });
    this.server = server;
    this.wss = new WebSocketServer({ server, maxPayload: 25 * 1024 * 1024 });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    // The server's errors are re-emitted here; its own listener below reports them.
    this.wss.on('error', () => {});
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.error =
        err.code === 'EADDRINUSE'
          ? `Port ${this.port} is already in use. Change it in settings or quit the other app.`
          : `The iPad connection couldn't start: ${err.message}`;
      this.pushStatus();
    });
    server.listen(this.port, () => {
      this.error = null;
      this.publish();
      this.pushStatus();
    });
    this.pingTimer = setInterval(() => {
      for (const s of this.sessions) {
        if (!s.alive) {
          s.ws.terminate();
          continue;
        }
        s.alive = false;
        s.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const s of this.sessions) s.ws.terminate();
    this.stopped = true;
    this.unpublish();
    this.wss?.close();
    this.server?.close();
  }

  // ---- status -----------------------------------------------------------------------

  status(): HubStatus {
    const addresses = lanAddresses();
    const connected = new Set([...this.sessions].filter((s) => s.authed).map((s) => s.deviceId));
    const host = localHostName();
    return {
      port: this.port,
      host: this.macName,
      addresses,
      pairingCode: this.pairing.code,
      qrPayload: `typink://pair?host=${encodeURIComponent(host)}&ip=${addresses.join(',')}&port=${this.port}&code=${this.pairing.code}`,
      devices: this.pairing.devices.map((d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, connected: connected.has(d.id) })),
      error: this.error,
    };
  }

  revoke(deviceId: string): void {
    this.pairing.revoke(deviceId);
    for (const s of this.sessions) if (s.deviceId === deviceId) s.ws.close(4001, 'forgotten');
    this.pushStatus();
  }

  get connected(): boolean {
    return [...this.sessions].some((s) => s.authed);
  }

  private pushStatus(): void {
    this.app.send('hub', this.status());
    // For testing against the iPad Simulator without looking at the window.
    if (process.env.TYPINK_LOG_PAIRING) console.log(`[hub] pairing code ${this.pairing.code} on port ${this.port}`);
  }

  /**
   * Advertises `_typink._tcp` through macOS's own mDNSResponder (`dns-sd -R`). Never an mDNS
   * responder inside the app: those also announce address records for the Mac's host name,
   * which macOS takes as a name conflict and renames the Mac ("MacBook-Air-2.local"),
   * breaking VPNs and anything else tied to the host name.
   */
  private publish(): void {
    if (this.stopped) return;
    // The iPad connects to host:port directly: WebSockets to a Bonjour
    // service endpoint never finish their handshake in Network.framework.
    const txt = [`proto=${PROTOCOL_VERSION}`, `host=${localHostName()}`, `port=${this.port}`];
    const child = spawn('/bin/sh', ['-c', ADVERTISE_SCRIPT, 'dns-sd', this.macName, '_typink._tcp', 'local', String(this.port), ...txt], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (d: Buffer) => console.warn('[hub] dns-sd:', d.toString().trim()));
    child.on('error', (err) => console.warn('[hub] could not advertise over Bonjour:', err.message));
    child.on('exit', () => {
      child.stdin?.destroy();
      if (this.advertiser !== child) return;
      // dns-sd ended on its own (mDNSResponder restarted): advertise again shortly.
      this.advertiser = null;
      setTimeout(() => this.publish(), 5000).unref();
    });
    this.advertiser = child;
  }

  private unpublish(): void {
    const child = this.advertiser;
    this.advertiser = null;
    child?.stdin?.end(); // the watchdog then stops dns-sd
  }

  // ---- connections -------------------------------------------------------------------------

  private onConnection(ws: WebSocket): void {
    const s: Session = {
      ws,
      alive: true,
      deviceId: null,
      name: 'iPad',
      authed: false,
      theme: 'light',
      view: null,
      lastActive: Date.now(),
      pdf: { timer: null, busy: false, dirty: false, lastAt: 0 },
    };
    this.sessions.add(s);
    ws.on('pong', () => (s.alive = true));
    ws.on('message', (data, isBinary) => void this.onMessage(s, data, isBinary));
    ws.on('close', () => {
      this.sessions.delete(s);
      if (s.pdf.timer) clearTimeout(s.pdf.timer);
      if (s.authed) this.pushStatus();
    });
    ws.on('error', () => ws.terminate());
  }

  private async onMessage(s: Session, data: RawData, isBinary: boolean): Promise<void> {
    s.alive = true;
    let header: unknown;
    let payload: Uint8Array = new Uint8Array();
    try {
      if (isBinary) {
        const frame = decodeFrame(toBytes(data));
        header = frame.header;
        payload = frame.payload;
      } else {
        header = JSON.parse(data.toString());
      }
    } catch {
      return this.send(s, { t: 'toast', message: 'The Mac could not read a message from this iPad.' });
    }
    const parsed = fromPad.safeParse(header);
    if (!parsed.success) {
      console.warn('[hub] invalid message', parsed.error.issues.slice(0, 3));
      return this.send(s, { t: 'toast', message: 'This version of Typink on your iPad is not compatible with the Mac.' });
    }
    const msg = parsed.data;
    if (!s.authed && msg.t !== 'hello' && msg.t !== 'pair') return;
    s.lastActive = Date.now();
    try {
      await this.handle(s, msg, payload);
    } catch (err) {
      console.error('[hub]', err);
      this.send(s, { t: 'toast', message: (err as Error).message });
    }
  }

  private async handle(s: Session, msg: FromPad, payload: Uint8Array): Promise<void> {
    switch (msg.t) {
      case 'hello': {
        if (msg.proto !== PROTOCOL_VERSION) {
          this.send(s, { t: 'toast', message: 'Please update Typink on your iPad and Mac to the same version.' });
          s.ws.close(4000, 'protocol');
          return;
        }
        s.deviceId = msg.deviceId;
        s.name = msg.name;
        s.theme = msg.appearance;
        if (msg.token && this.pairing.verify(msg.deviceId, msg.token)) return this.authenticated(s);
        return this.send(s, { t: 'pairNeeded', macName: this.macName });
      }
      case 'pair': {
        if (!s.deviceId) return;
        const result = this.pairing.attempt(s.deviceId, s.name, msg.code);
        if (!result.ok) {
          this.pushStatus(); // the code may have rotated
          return this.send(s, { t: 'pairFailed', reason: result.reason });
        }
        this.send(s, { t: 'paired', token: result.token });
        this.app.command({ type: 'toast', message: `Paired with ${s.name}` });
        return this.authenticated(s);
      }
      case 'listNotes':
        return this.sendNotes(s);
      case 'view':
        s.view = msg.note;
        s.theme = msg.theme;
        return this.schedulePdf(s, 0);
      case 'sketchNew':
        return this.newSketchFromPad(s);
      case 'sketchRequest':
        return this.sendSketch(s, msg.id);
      case 'sketchPut':
        return this.saveSketchFromPad(s, msg, payload);
      case 'sketchClose':
        return;
      case 'annotatePut':
        try {
          await this.app.annotations.save(msg, payload, await this.snapshotFor(msg.note, msg.viewedRev));
        } finally {
          // Also after an error: sending the same handwriting again wouldn't go any better.
          this.send(s, { t: 'annotateAck', note: msg.note });
        }
        this.app.recompileNote(msg.note);
        return;
      case 'image':
        return this.imageFromPad(s, msg, payload);
    }
  }

  private authenticated(s: Session): void {
    s.authed = true;
    this.send(s, { t: 'welcome', proto: PROTOCOL_VERSION, macName: this.macName });
    this.sendNotes(s);
    this.schedulePdf(s, 0);
    this.pushStatus();
  }

  // ---- outgoing ---------------------------------------------------------------------------

  private send(s: Session, msg: ToPad, payload?: Uint8Array): void {
    if (s.ws.readyState !== s.ws.OPEN) return;
    if (payload) s.ws.send(encodeFrame(msg, payload), { binary: true });
    else s.ws.send(JSON.stringify(msg));
  }

  private sendNotes(s: Session): void {
    const listing = this.app.library.list();
    this.send(s, {
      t: 'notes',
      notes: listing.notes.map((n) => ({ path: n.path, name: n.name, folder: n.folder, mtime: n.mtime })),
      active: this.app.activeNote,
    });
  }

  private noteFor(s: Session): string | null {
    const note = s.view ?? this.app.activeNote;
    if (!note) return null;
    try {
      return note.endsWith('.typ') && fs.existsSync(this.app.library.abs(note)) ? note : null;
    } catch {
      return null;
    }
  }

  /** Called whenever a note was recompiled on the Mac. */
  noteChanged(notePath: string): void {
    for (const s of this.sessions) if (s.authed && this.noteFor(s) === notePath) this.schedulePdf(s, 0);
  }

  /** The Mac opened a different note: followers switch along. */
  activeNoteChanged(): void {
    for (const s of this.sessions) {
      if (!s.authed) continue;
      this.sendNotes(s);
      if (s.view === null) this.schedulePdf(s, 0);
    }
  }

  libraryChanged(): void {
    for (const s of this.sessions) if (s.authed) this.sendNotes(s);
  }

  private schedulePdf(s: Session, delayMs: number): void {
    if (s.pdf.timer) return;
    const wait = Math.max(delayMs, PDF_MIN_INTERVAL_MS - (Date.now() - s.pdf.lastAt));
    s.pdf.timer = setTimeout(() => {
      s.pdf.timer = null;
      void this.sendPdf(s);
    }, Math.max(0, wait));
  }

  private async sendPdf(s: Session): Promise<void> {
    if (s.pdf.busy) {
      s.pdf.dirty = true;
      return;
    }
    const note = this.noteFor(s);
    if (!note) return;
    s.pdf.busy = true;
    try {
      const out = await this.app.compiler.compile(note, { theme: s.theme, ann: 'off' }, { pdf: true, svg: true, query: true });
      if (!out.ok || !out.pdf) return;
      const preview = this.app.compiler.toPreview(note, 0, s.theme, out);
      const rev = (this.revs.get(note) ?? REV_BASE) + 1;
      this.revs.set(note, rev);
      this.remember(note, { rev, blocks: preview.blocks, layout: preview.layout, sketches: preview.sketches });
      this.send(s, {
        t: 'note',
        note,
        title: path.basename(note, '.typ'),
        rev,
        following: s.view === null,
        pages: preview.pages,
        sketches: preview.sketches,
        ruling: preview.layout?.ruled
          ? { template: preview.layout.template, pitch: preview.layout.pitch, offsetX: preview.layout.originX, offsetY: preview.layout.originY }
          : null,
      });
      const { payload, ranges } = packParts({ data: out.pdf });
      this.send(s, { t: 'pdf', note, rev, theme: s.theme, parts: { data: ranges.data! } }, payload);
      const ann = this.app.annotations.forPad(note, preview.blocks);
      if (ann) {
        const packed = packParts(Object.fromEntries(ann.map((c) => [c.id, c.pk])) as Record<string, Uint8Array>);
        this.send(
          s,
          {
            t: 'annotations',
            note,
            rev,
            clusters: ann.map((c) => ({ id: c.id, page: c.page, x: c.x, y: c.y, w: c.w, h: c.h, pk: packed.ranges[c.id]! })),
          },
          packed.payload,
        );
      }
    } finally {
      s.pdf.busy = false;
      s.pdf.lastAt = Date.now();
      if (s.pdf.dirty) {
        s.pdf.dirty = false;
        this.schedulePdf(s, 0);
      }
    }
  }

  private remember(note: string, snap: NoteSnapshot): void {
    const list = this.snapshots.get(note) ?? [];
    list.push(snap);
    if (list.length > 20) list.shift();
    this.snapshots.set(note, list);
  }

  /** The layout the iPad was looking at when it drew (falls back to the newest). */
  snapshot(note: string, rev: number): NoteSnapshot | null {
    const list = this.snapshots.get(note) ?? [];
    return list.find((s) => s.rev === rev) ?? list[list.length - 1] ?? null;
  }

  /** Like snapshot(), but lays the note out now if this Mac hasn't yet (ink sent again after a restart). */
  private async snapshotFor(note: string, rev: number): Promise<NoteSnapshot | null> {
    const known = this.snapshot(note, rev);
    if (known) return known;
    const out = await this.app.compiler.compile(note, { theme: 'light', ann: 'off' }, { svg: true, query: true });
    if (!out.ok) return null;
    const preview = this.app.compiler.toPreview(note, 0, 'light', out);
    return { rev, blocks: preview.blocks, layout: preview.layout, sketches: preview.sketches };
  }

  // ---- sketches -------------------------------------------------------------------------------

  /** "Edit on iPad": opens the sketch on the most recently used iPad. */
  openSketch(id: string): boolean {
    const s = this.primary();
    if (!s) return false;
    void this.sendSketch(s, id).catch((err) => console.error('[hub] open sketch', err));
    return true;
  }

  private primary(): Session | null {
    let best: Session | null = null;
    for (const s of this.sessions) if (s.authed && (!best || s.lastActive > best.lastActive)) best = s;
    return best;
  }

  private async sendSketch(s: Session, id: string): Promise<void> {
    const library = this.app.library;
    const info = library.readManifest().ink[id];
    if (!info) return this.send(s, { t: 'toast', message: 'That sketch no longer exists.' });

    const found = await this.app.waitForSketchPlacement(id, 3000);
    let size = { w: info.w, h: info.h };
    // An empty sketch adopts the width it actually got on the page, so ink is 1:1 with the text.
    if (found && info.n === 0 && Math.abs(found.placement.w - info.w) > 0.5) {
      const h = Math.round(info.h * (found.placement.w / info.w) * 100) / 100;
      const pitch = found.layout?.ruled ? found.layout.pitch : 0;
      size = { w: Math.round(found.placement.w * 100) / 100, h: pitch ? Math.max(pitch, Math.round(h / pitch) * pitch) : h };
      resizeSketch(library, id, size.w, size.h);
    }

    let ruling: Ruling | null = null;
    if (found?.layout?.ruled) {
      const { layout, placement } = found;
      const k = size.w / placement.w; // canvas units per page point
      const mod = (a: number, m: number) => ((a % m) + m) % m;
      ruling = {
        template: layout.template,
        pitch: layout.pitch * k,
        offsetX: mod((layout.originX - placement.x) * k, layout.pitch * k),
        offsetY: mod((layout.originY - placement.y) * k, layout.pitch * k),
      };
    }

    const on = found?.placement.on ?? null;
    let background: { path: string; mime: string; page: number | null } | null = null;
    let backgroundBytes: Uint8Array | null = null;
    if (on) {
      try {
        backgroundBytes = new Uint8Array(fs.readFileSync(library.abs(on)));
        background = { path: on, mime: mimeFor(on), page: found?.placement.onPage ?? null };
      } catch {
        background = null;
      }
    }

    const { payload, ranges } = packParts({ pk: readPencilKitData(library, id), background: backgroundBytes });
    this.send(
      s,
      {
        t: 'sketchOpen',
        note: found?.note ?? this.app.activeNote ?? '',
        id,
        rev: info.rev,
        size,
        ruling,
        background,
        parts: ranges,
      },
      payload,
    );
  }

  private saveSketchFromPad(s: Session, msg: Extract<FromPad, { t: 'sketchPut' }>, payload: Uint8Array): void {
    // Deleted on the Mac meanwhile: nothing to save, but the iPad can stop sending it.
    if (!this.app.library.readManifest().ink[msg.id]) return this.send(s, { t: 'sketchAck', id: msg.id, rev: 0 });
    const saved = saveSketch(this.app.library, msg.id, { size: msg.size, render: msg.render, pk: part(payload, msg.parts.pk) });
    this.send(s, { t: 'sketchAck', id: msg.id, rev: saved.rev });
    this.app.send('sketch-updated', { id: msg.id, rev: saved.rev, n: saved.n });
    this.app.recompileActive(40);
  }

  private async newSketchFromPad(s: Session): Promise<void> {
    if (!this.app.activeNote) return this.send(s, { t: 'toast', message: 'Open a note on your Mac first.' });
    const { id, snippet } = this.app.newSketch({});
    this.app.command({ type: 'insert', text: snippet, block: true });
    await this.sendSketch(s, id);
  }

  private async imageFromPad(s: Session, msg: Extract<FromPad, { t: 'image' }>, payload: Uint8Array): Promise<void> {
    const data = part(payload, msg.parts.data);
    if (!data || data.length === 0) return;
    if (!this.app.activeNote) return this.send(s, { t: 'toast', message: 'Open a note on your Mac first.' });
    const ext = msg.mime === 'image/png' ? 'png' : msg.mime === 'application/pdf' ? 'pdf' : 'jpg';
    const file = this.app.library.importAttachment(data, ext);
    if (msg.mode === 'insert') {
      this.app.command({ type: 'insert', text: `#figure(image("${file}", width: 80%))`, block: true });
      this.send(s, { t: 'toast', message: 'Photo added to your note' });
      return;
    }
    const { id, snippet } = this.app.newSketch({ on: file });
    this.app.command({ type: 'insert', text: snippet, block: true });
    await this.sendSketch(s, id);
  }
}

// ---- helpers ---------------------------------------------------------------------------------

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function mimeFor(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return (
    { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' }[
      ext
    ] ?? 'application/octet-stream'
  );
}

function computerName(): string {
  try {
    const name = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim();
    if (name) return name;
  } catch {
    // not macOS, or scutil unavailable
  }
  return os.hostname().replace(/\.local$/, '');
}

/** The Mac's mDNS name, e.g. "MacBook-Air.local". */
function localHostName(): string {
  try {
    const name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim();
    if (name) return `${name}.local`;
  } catch {
    // fall through
  }
  const host = os.hostname();
  return host.endsWith('.local') ? host : `${host}.local`;
}

function lanAddresses(): string[] {
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
    }
  }
  // Wi-Fi/Ethernet (en*) before VPNs and bridges.
  out.sort((a, b) => Number(!a.name.startsWith('en')) - Number(!b.name.startsWith('en')) || a.name.localeCompare(b.name));
  return out.map((a) => a.address);
}
