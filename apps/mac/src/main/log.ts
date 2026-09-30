// A log file, so problems on someone else's Mac can be diagnosed: everything the main
// process and the Typst compiler print also goes to ~/Library/Logs/Typink/main.log
// (Help › Show Logs). The file is rotated at startup once it passes 5 MB.

import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { app } from 'electron';

const MAX_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let file = '';

export function startLogging(): void {
  // Tests and demos keep their logs next to their throwaway settings.
  const custom = process.env.TYPINK_USER_DATA;
  app.setAppLogsPath(custom ? path.join(custom, 'logs') : undefined);
  const dir = app.getPath('logs');
  file = path.join(dir, 'main.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'main.old.log'));
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null; // a full or read-only disk shouldn't take the app down
    });
  } catch {
    return;
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level, format(...args));
    };
  }
  write('info', `Typink ${app.getVersion()} (${app.isPackaged ? 'release' : 'development'}) on macOS ${process.getSystemVersion()}, ${process.arch}`);
}

function write(level: string, message: string): void {
  stream?.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}\n`);
}

export function logFilePath(): string {
  return file;
}
