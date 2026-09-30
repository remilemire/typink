import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, net, protocol, shell } from 'electron';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { APP_DIR } from './store/library';
import { Typink } from './typink';

// typink://ink/<file>, typink://ann/<file> and typink://attachments/<file> serve
// drawings and images from the library to the renderer (thumbnails, overlays).
protocol.registerSchemesAsPrivileged([
  { scheme: 'typink', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Tests and demos can run against throwaway settings and notes folders.
if (process.env.TYPINK_USER_DATA) app.setPath('userData', process.env.TYPINK_USER_DATA);

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
    },
  });
  win.once('ready-to-show', () => win.show());

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

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));

  typink!.window = win;
  win.on('closed', () => {
    if (typink?.window === win) typink.window = null;
  });
}

void app.whenReady().then(() => {
  typink = new Typink();
  protocol.handle('typink', serveLibraryFile);
  registerIpc(typink);
  installMenu(typink);
  typink.start();
  createWindow();
  started = true;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
