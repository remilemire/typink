import { contextBridge, ipcRenderer } from 'electron';
import type { TypinkApi, TypinkEvents } from '@shared/api';

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api: TypinkApi = {
  bootstrap: call('bootstrap') as TypinkApi['bootstrap'],
  updateSettings: call('settings:update') as TypinkApi['updateSettings'],
  chooseLibrary: call('library:choose') as TypinkApi['chooseLibrary'],
  listLibrary: call('library:list') as TypinkApi['listLibrary'],
  openNote: call('note:open') as TypinkApi['openNote'],
  updateNote: call('note:update') as TypinkApi['updateNote'],
  saveNote: call('note:save') as TypinkApi['saveNote'],
  createNote: call('note:create') as TypinkApi['createNote'],
  createFolder: call('folder:create') as TypinkApi['createFolder'],
  renameEntry: call('entry:rename') as TypinkApi['renameEntry'],
  moveEntry: call('entry:move') as TypinkApi['moveEntry'],
  trashEntry: call('entry:trash') as TypinkApi['trashEntry'],
  revealEntry: call('entry:reveal') as TypinkApi['revealEntry'],
  importAttachment: call('attachment:import') as TypinkApi['importAttachment'],
  pickAttachments: call('attachment:pick') as TypinkApi['pickAttachments'],
  newSketch: call('sketch:new') as TypinkApi['newSketch'],
  editSketch: call('sketch:edit') as TypinkApi['editSketch'],
  exportNote: call('export') as TypinkApi['exportNote'],
  revealFile: call('file:reveal') as TypinkApi['revealFile'],
  hubStatus: call('hub:status') as TypinkApi['hubStatus'],
  revokeDevice: call('hub:revoke') as TypinkApi['revokeDevice'],
  on<E extends keyof TypinkEvents>(event: E, listener: (payload: TypinkEvents[E]) => void) {
    const handler = (_: unknown, payload: TypinkEvents[E]) => listener(payload);
    ipcRenderer.on(`event:${event}`, handler);
    return () => ipcRenderer.removeListener(`event:${event}`, handler);
  },
};

contextBridge.exposeInMainWorld('typink', api);
