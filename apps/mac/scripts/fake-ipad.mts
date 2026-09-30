// A stand-in for the iPad app, for testing the Mac side without a device.
//
//   node scripts/fake-ipad.mts [--host localhost] [--port 47321] [--code 123456] [--sketch] [--annotate] [--photo file.jpg]
//
// Without --code it asks for the pairing code shown on the Mac. The token is
// remembered in ~/.typink-fake-ipad.json so later runs skip pairing.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { WebSocket } from 'ws';
import { decodeFrame, encodeFrame, packParts, type RenderStroke } from '../../../packages/protocol/src/index.ts';

type Msg = { t: string; [key: string]: any };

export interface FakeIpadOptions {
  host?: string;
  port?: number;
  code?: string | (() => Promise<string>);
  stateFile?: string;
  log?: (line: string) => void;
}

/** A synthetic handwritten stroke: a wobbly line with pressure-like width changes. */
export function scribble(x0: number, y0: number, length: number, colour = '#1d4ed8ff'): RenderStroke {
  const points: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    points.push(x0 + t * length, y0 + Math.sin(t * Math.PI * 3) * 6, 1.2 + Math.sin(t * Math.PI) * 1.6, 1);
  }
  return { ink: 'pen', color: colour, colorDark: '#93c5fdff', points };
}

export function circle(cx: number, cy: number, r: number, colour = '#dc2626ff'): RenderStroke {
  const points: number[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2.1;
    points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, 1.8, 1);
  }
  return { ink: 'pen', color: colour, colorDark: '#fca5a5ff', points };
}

export class FakeIpad {
  ws!: WebSocket;
  readonly received: Msg[] = [];
  private waiters: { match: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  private readonly state: { deviceId: string; token?: string };
  private readonly stateFile: string;
  private readonly log: (line: string) => void;
  private readonly opts: FakeIpadOptions;

  constructor(opts: FakeIpadOptions = {}) {
    this.opts = opts;
    this.stateFile = opts.stateFile ?? path.join(os.homedir(), '.typink-fake-ipad.json');
    this.log = opts.log ?? ((line) => console.log(line));
    try {
      this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      this.state = { deviceId: randomUUID() };
    }
  }

  async connect(): Promise<void> {
    const url = `ws://${this.opts.host ?? 'localhost'}:${this.opts.port ?? 47321}`;
    this.ws = new WebSocket(url);
    this.ws.on('message', (data, isBinary) => {
      let msg: Msg;
      if (isBinary) {
        const frame = decodeFrame(new Uint8Array(data as Buffer));
        msg = { ...(frame.header as Msg), payloadBytes: frame.payload.length, payload: frame.payload };
      } else {
        msg = JSON.parse(data.toString());
      }
      this.received.push(msg);
      this.log(`← ${msg.t}${msg.t === 'toast' ? `: ${msg.message}` : ''}${msg.payloadBytes ? ` (${msg.payloadBytes} bytes)` : ''}`);
      this.waiters = this.waiters.filter((w) => (w.match(msg) ? (w.resolve(msg), false) : true));
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    // The Mac answers some messages back to back (paired, then welcome); when they arrive in
    // one read, the second is already in `received` before we start waiting for it.
    const mark = this.received.length;
    this.send({ t: 'hello', proto: 1, deviceId: this.state.deviceId, name: 'Fake iPad', token: this.state.token, appearance: 'light' });
    const reply = await this.nextSince(mark, (m) => m.t === 'welcome' || m.t === 'pairNeeded');
    if (reply.t === 'pairNeeded') {
      const code = typeof this.opts.code === 'function' ? await this.opts.code() : (this.opts.code ?? (await ask('Pairing code shown on the Mac: ')));
      this.send({ t: 'pair', code });
      const result = await this.nextSince(mark, (m) => m.t === 'paired' || m.t === 'pairFailed');
      if (result.t === 'pairFailed') throw new Error(result.reason);
      this.state.token = result.token;
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state));
      await this.nextSince(mark, (m) => m.t === 'welcome');
    }
  }

  /** Like next(), but a matching message that arrived after received[since] counts too. */
  nextSince(since: number, match: (m: Msg) => boolean, timeoutMs?: number): Promise<Msg> {
    const found = this.received.slice(since).find(match);
    return found ? Promise.resolve(found) : this.next(match, timeoutMs);
  }

  send(msg: Msg, payload?: Uint8Array): void {
    this.log(`→ ${msg.t}`);
    if (payload) this.ws.send(encodeFrame(msg, payload), { binary: true });
    else this.ws.send(JSON.stringify(msg));
  }

  next(match: (m: Msg) => boolean, timeoutMs = 15_000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the Mac')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Asks the Mac for a new sketch at its cursor and draws into it. */
  async drawSketch(strokes?: RenderStroke[]): Promise<{ id: string; rev: number }> {
    this.send({ t: 'sketchNew' });
    const open = await this.next((m) => m.t === 'sketchOpen');
    const size = open.size as { w: number; h: number };
    const render = strokes ?? [scribble(20, size.h / 2, size.w - 40), circle(size.w / 2, size.h / 2, 30)];
    const pk = new TextEncoder().encode('fake-pencilkit-data');
    const { payload, ranges } = packParts({ pk });
    this.send({ t: 'sketchPut', id: open.id, rev: 1, size, render, parts: { pk: ranges.pk } }, payload);
    const ack = await this.next((m) => m.t === 'sketchAck' && m.id === open.id);
    return { id: open.id, rev: ack.rev };
  }

  /** Circles something on page 1 of the note it's viewing. */
  async annotate(note: string, rev: number, bbox: [number, number, number, number]): Promise<void> {
    const [x, y, w, h] = bbox;
    const pk = new TextEncoder().encode('fake-cluster');
    const { payload, ranges } = packParts({ c1: pk });
    this.send(
      {
        t: 'annotatePut',
        note,
        viewedRev: rev,
        pages: [1],
        clusters: [{ id: 'c1', page: 1, bbox: [x, y, w, h], render: [circle(w / 2, h / 2, w / 2 - 4)], pk: ranges.c1 }],
      },
      payload,
    );
    await this.next((m) => m.t === 'annotateAck' && m.note === note);
  }

  async sendPhoto(file: string, mode: 'insert' | 'drawOn'): Promise<void> {
    const data = new Uint8Array(fs.readFileSync(file));
    const { payload, ranges } = packParts({ data });
    const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    this.send({ t: 'image', name: path.basename(file), mime, mode, parts: { data: ranges.data } }, payload);
  }

  close(): void {
    this.ws.close();
  }
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// ---- CLI -------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const ipad = new FakeIpad({ host: value('host'), port: Number(value('port')) || undefined, code: value('code') });
  await ipad.connect();
  const note = await ipad.next((m) => m.t === 'note', 20_000).catch(() => null);
  if (note) console.log(`Viewing ${note.note} (rev ${note.rev}, ${note.pages.length} page(s), ${note.sketches.length} sketch(es))`);
  if (flag('sketch')) console.log('Sketch saved:', await ipad.drawSketch());
  if (flag('annotate') && note) {
    await ipad.annotate(note.note, note.rev, [300, 90, 120, 44]);
    console.log('Annotation sent');
  }
  const photo = value('photo');
  if (photo) await ipad.sendPhoto(photo, flag('draw-on') ? 'drawOn' : 'insert');
  await new Promise((r) => setTimeout(r, 1500));
  ipad.close();
}
