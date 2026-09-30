import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, net, protocol, shell } from 'electron';
import { registerIpc } from './ipc';
import { startLogging } from './log';
import { installMenu } from './menu';
import { APP_DIR } from './store/library';
import { Typink } from './typink';
import { startUpdates } from './updates';

// typink://ink/<file>, typink://ann/<file> and typink://attachments/<file> serve
// drawings and images from the library to the renderer (thumbnails, overlays).
protocol.registerSchemesAsPrivileged([
  { scheme: 'typink', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Tests and demos can run against throwaway settings and notes folders.
if (process.env.TYPINK_USER_DATA) app.setPath('userData', process.env.TYPINK_USER_DATA);

// One Typink at a time: a second copy would fight over the iPad port and the notes folder.
// (The lock lives in the userData folder, so tests with their own folder don't collide.)
if (!app.requestSingleInstanceLock()) app.exit(0);

startLogging();
migrateLegacySettings();

/** Before 1.0 the app ran under its package name, "@typink/mac", and kept its settings there. */
function migrateLegacySettings(): void {
  if (process.env.TYPINK_USER_DATA) return;
  const target = path.join(app.getPath('userData'), 'settings.json');
  const legacy = path.join(app.getPath('appData'), '@typink', 'mac', 'settings.json');
  try {
    if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacy, target);
    console.info('[main] moved settings from', legacy);
  } catch (err) {
    console.warn('[main] could not move the old settings', err);
  }
}

let typink: Typink | null = null;
let started = false;
let lastReported = '';

// Electron's default for an uncaught error is a modal dialog per occurrence; one that repeats
// (a network hiccup, a folder that vanished) brings them back faster than they can be
// dismissed. Once running, errors are logged and shown as a toast instead.
function reportUnexpected(err: unknown, notify: boolean): void {
  console.error('[main] unexpected error', err);
  const message = err instanceof Error ? err.message : String(err);
  if (!started) {
    dialog.showErrorBox('Typink couldn’t start', message);
    app.exit(1);
    return;
  }
  if (!notify || message === lastReported) return;
  lastReported = message;
  typink?.command({ type: 'toast', message: `Something went wrong: ${message}` });
}
process.on('uncaughtException', (err) => reportUnexpected(err, true));
process.on('unhandledRejection', (reason) => reportUnexpected(reason, false));

function serveLibraryFile(request: Request): Promise<Response> | Response {
  if (!typink) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const root = typink.library.root;
  const bases: Record<string, string> = {
    ink: path.join(root, APP_DIR, 'ink'),
    ann: path.join(root, APP_DIR, 'ann'),
    attachments: path.join(root, 'attachments'),
  };
  const base = bases[url.hostname];
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = base ? path.resolve(base, rel) : '';
  if (!base || !rel || !file.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Typink',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#fbfbfa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // The released app has no DevTools unless TYPINK_DEVTOOLS=1 (for debugging a user's problem).
      devTools: !app.isPackaged || process.env.TYPINK_DEVTOOLS === '1',
    },
  });
  win.once('ready-to-show', () => win.show());
  // The window's own failures go to the app log too, for diagnosing problems on other Macs.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[window] failed to load', url, code, description);
  });
  win.webContents.on('preload-error', (_event, file, error) => console.error('[window] preload failed', file, error));
  win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'error') console.error('[renderer]', message, `(${path.basename(sourceId)}:${lineNumber})`);
  });

  // Links open in the browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // electron-vite's dev server; the released app only ever loads its own files.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));

  typink!.window = win;
  win.on('closed', () => {
    if (typink?.window === win) typink.window = null;
  });
}

/** Updates only install into /Applications, so offer to move a copy that runs from the DMG or Downloads. */
async function offerMoveToApplications(): Promise<void> {
  if (!app.isPackaged || process.env.TYPINK_USER_DATA || app.isInApplicationsFolder()) return;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Move Typink to your Applications folder?',
    detail: 'Typink keeps itself up to date there.',
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    app.moveToApplicationsFolder();
  } catch (err) {
    console.warn('[main] could not move to Applications', err);
  }
}

void app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Typink',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Rémi Lemire',
    credits: 'Typst notes with Apple Pencil ink from your iPad.',
  });
  typink = new Typink();
  protocol.handle('typink', serveLibraryFile);
  registerIpc(typink);
  installMenu(typink);
  typink.start();
  createWindow();
  started = true;
  startUpdates({
    onChange: () => typink && installMenu(typink),
    notify: (message) => typink?.command({ type: 'toast', message }),
  });
  void offerMoveToApplications();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  const win = typink?.window;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else if (typink) {
    createWindow();
  }
});

app.on('render-process-gone', (_event, _contents, details) => {
  console.error('[main] window process ended:', details.reason, details.exitCode);
});
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  console.error('[main] helper process ended:', details.type, details.serviceName ?? '', details.reason, details.exitCode);
});

// Everything shutdown does is synchronous (saves, settings, closing servers), so it
// runs right here instead of postponing the quit.
app.on('before-quit', () => {
  try {
    typink?.shutdown();
  } catch (err) {
    console.error('[shutdown]', err);
  }
  typink = null;
});

app.on('window-all-closed', () => {
  // Notes stay reachable from the Dock; quit explicitly with ⌘Q.
  if (process.platform !== 'darwin') app.quit();
});
