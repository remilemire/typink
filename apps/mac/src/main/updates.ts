// Automatic updates from GitHub Releases (github.com/remilemire/typink), with electron-updater.
//
// Only the packaged, signed app updates: Squirrel.Mac installs a new version only if it's
// signed by the same team, and only into a copy in /Applications. Development builds and
// tests (TYPINK_USER_DATA) never contact GitHub. Checks run in the background; failures
// stay in the log unless you asked via "Check for Updates…".

import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

type State = 'idle' | 'checking' | 'downloading' | 'ready';

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let state: State = 'idle';
let readyVersion = '';
let onChange: () => void = () => {};

export function updatesAvailable(): boolean {
  return app.isPackaged && !process.env.TYPINK_USER_DATA;
}

export function startUpdates(hooks: { onChange: () => void; notify: (message: string) => void }): void {
  onChange = hooks.onChange;
  if (!updatesAvailable()) return;
  autoUpdater.logger = {
    info: (message) => console.info('[update]', message),
    warn: (message) => console.warn('[update]', message),
    error: (message) => console.error('[update]', message),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setState('checking'));
  autoUpdater.on('update-available', () => setState('downloading'));
  autoUpdater.on('update-not-available', () => setState('idle'));
  autoUpdater.on('error', () => setState(readyVersion ? 'ready' : 'idle'));
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    setState('ready');
    hooks.notify(`Typink ${info.version} is ready. It installs when you quit.`);
  });
  setTimeout(() => void check(false), FIRST_CHECK_MS).unref();
  setInterval(() => void check(false), CHECK_EVERY_MS).unref();
}

function setState(next: State): void {
  state = next;
  onChange();
}

async function check(manual: boolean): Promise<void> {
  if (state !== 'idle') return;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (manual && !result?.isUpdateAvailable) {
      await dialog.showMessageBox({ message: 'You’re up to date', detail: `Typink ${app.getVersion()} is the newest version.` });
    }
  } catch (err) {
    console.warn('[update] check failed', err);
    if (manual) {
      await dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates', detail: (err as Error).message });
    }
  }
}

/** The app menu's update item: "Check for Updates…", or "Restart to Update" once one is ready. */
export function updateMenuItem(): Electron.MenuItemConstructorOptions {
  if (state === 'ready') {
    return { label: `Restart to Install Typink ${readyVersion}`, click: () => autoUpdater.quitAndInstall() };
  }
  return {
    label: state === 'downloading' ? 'Downloading Update…' : 'Check for Updates…',
    enabled: updatesAvailable() && state === 'idle',
    click: () => void check(true),
  };
}
