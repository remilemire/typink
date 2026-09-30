// Owns the compiler utility process: one request at a time, with a timeout
// that kills and restarts the process if Typst hangs or crashes.

import { utilityProcess, type UtilityProcess } from 'electron';
import enginePath from './engine?modulePath';
import type { EngineCompileResult, EngineRequest, EngineResponse } from './protocol';

type Payload = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

interface Job {
  payload: Payload;
  timeoutMs: number;
  resolve: (res: EngineResponse) => void;
  reject: (err: Error) => void;
}

export class CompileHost {
  private child: UtilityProcess | null = null;
  private ready = false;
  private queue: Job[] = [];
  private running: { job: Job; id: number; timer: NodeJS.Timeout } | null = null;
  private nextId = 1;
  private stopped = false;
  private restarts = 0;

  constructor(private root: string) {}

  start(): void {
    this.stopped = false;
    const child = utilityProcess.fork(enginePath, [], { serviceName: 'Typst compiler', stdio: 'inherit' });
    this.child = child;
    this.ready = false;
    child.on('message', (msg: EngineResponse) => this.onMessage(msg));
    child.on('exit', (code) => this.onExit(child, code));
    // `init` jumps the queue so the compiler exists before any compile.
    this.queue.unshift({
      payload: { type: 'init', root: this.root },
      timeoutMs: 30_000,
      resolve: () => {
        this.ready = true;
        this.restarts = 0;
      },
      reject: () => {},
    });
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }

  setRoot(root: string): void {
    this.root = root;
    this.restart('library changed');
  }

  get isReady(): boolean {
    return this.ready;
  }

  async compile(payload: Extract<Payload, { type: 'compile' }>, timeoutMs = 15_000): Promise<EngineCompileResult> {
    const res = await this.request(payload, timeoutMs);
    if (!res.ok) throw new Error(res.error);
    return res.result!;
  }

  async unmap(path: string): Promise<void> {
    await this.request({ type: 'unmap', path }, 5_000).catch(() => {});
  }

  request(payload: Payload, timeoutMs: number): Promise<EngineResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, timeoutMs, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.running || !this.child || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    const id = this.nextId++;
    const timer = setTimeout(() => {
      if (this.running?.id !== id) return;
      this.running = null;
      job.reject(new Error(`Typst took longer than ${Math.round(job.timeoutMs / 1000)} s and was restarted`));
      this.restart('timeout');
    }, job.timeoutMs);
    this.running = { job, id, timer };
    this.child.postMessage({ ...job.payload, id } as EngineRequest);
  }

  private onMessage(msg: EngineResponse): void {
    if (!this.running || this.running.id !== msg.id) return;
    const { job, timer } = this.running;
    clearTimeout(timer);
    this.running = null;
    job.resolve(msg);
    this.pump();
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (child !== this.child) return;
    this.child = null;
    this.ready = false;
    if (this.running) {
      clearTimeout(this.running.timer);
      this.running.job.reject(new Error(`the Typst compiler stopped unexpectedly (code ${code})`));
      this.running = null;
    }
    if (this.stopped) return;
    // Crash loop protection: back off after repeated failures.
    const delay = Math.min(5_000, 200 * 2 ** this.restarts++);
    setTimeout(() => {
      if (!this.stopped && !this.child) this.start();
    }, delay);
  }

  private restart(reason: string): void {
    console.warn(`[compile] restarting compiler: ${reason}`);
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (this.running) {
      clearTimeout(this.running.timer);
      this.running = null;
    }
    child?.kill();
    if (!this.stopped) this.start();
  }
}
