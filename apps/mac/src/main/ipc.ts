import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, ExportOptions } from '@shared/types';
import type { Typink } from './typink';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'];

export function registerIpc(app: Typink): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (_event, ...args) => fn(...args));

  handle('bootstrap', () => app.bootstrap());
  handle('settings:update', (patch: Partial<AppSettings>) => app.updateSettings(patch));
  handle('library:choose', () => app.chooseLibrary());
  handle('library:list', () => app.library.list());

  handle('note:open', (rel: string) => app.openNote(rel));
  handle('note:update', (rel: string, text: string) => app.updateNote(rel, text));
  handle('note:save', (rel: string, text: string) => app.saveNote(rel, text));
  handle('note:create', (folder: string, name: string) => {
    const meta = app.library.create(folder, name);
    app.pushLibrary();
    return meta;
  });
  handle('folder:create', (name: string) => {
    const rel = app.library.createFolder(name);
    app.pushLibrary();
    return rel;
  });
  handle('entry:rename', (rel: string, name: string) => app.renameEntry(rel, name));
  handle('entry:move', (rel: string, folder: string) => app.moveEntry(rel, folder));
  handle('entry:trash', (rel: string) => app.trashEntry(rel));
  handle('entry:reveal', (rel: string) => app.revealEntry(rel));

  handle('attachment:import', (data: Uint8Array, ext: string) => app.library.importAttachment(data, ext));
  handle('attachment:pick', async () => {
    const res = await dialog.showOpenDialog(app.window!, {
      title: 'Import images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and PDFs', extensions: IMAGE_EXTENSIONS }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((file) =>
      app.library.importAttachment(fs.readFileSync(file), path.extname(file).slice(1)),
    );
  });

  handle('sketch:new', (options: { on?: string; open?: boolean }) => app.newSketch(options));
  handle('sketch:edit', (id: string) => app.editSketch(id));

  handle('export', (rel: string, options: ExportOptions) => app.exportNote(rel, options));

  handle('file:reveal', (file: string) => shell.showItemInFolder(file));
  handle('hub:status', () => app.hubStatus());
  handle('hub:revoke', (id: string) => app.revokeDevice(id));
}
