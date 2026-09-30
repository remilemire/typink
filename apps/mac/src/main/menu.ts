import { app as electronApp, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import type { AppearanceSetting, FormatAction, RendererCommand } from '@shared/types';
import { logFilePath } from './log';
import type { Typink } from './typink';
import { updateMenuItem } from './updates';

const REPO = 'https://github.com/remilemire/typink';

export function installMenu(app: Typink): void {
  const run = (cmd: RendererCommand) => () => app.command(cmd);
  const format = (action: FormatAction) => run({ type: 'format', action });
  const appearance = (value: AppearanceSetting): MenuItemConstructorOptions => ({
    label: value === 'system' ? 'Match System' : value === 'light' ? 'Light' : 'Dark',
    type: 'radio',
    checked: app.settings.settings.appearance === value,
    // nativeTheme's `updated` event tells the renderer about the change.
    click: () => app.updateSettings({ appearance: value }),
  });

  const devTools = !electronApp.isPackaged || process.env.TYPINK_DEVTOOLS === '1';

  const template: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        updateMenuItem(),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: run({ type: 'new-note' }) },
        { label: 'New Notebook', accelerator: 'CmdOrCtrl+Shift+N', click: run({ type: 'new-folder' }) },
        { type: 'separator' },
        { label: 'Import Image…', accelerator: 'CmdOrCtrl+Shift+I', click: run({ type: 'import-image' }) },
        { type: 'separator' },
        { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+P', click: run({ type: 'export', format: 'pdf' }) },
        { label: 'Export as PNG…', click: run({ type: 'export', format: 'png' }) },
        { label: 'Export as JPEG…', click: run({ type: 'export', format: 'jpeg' }) },
        { type: 'separator' },
        {
          label: 'Choose Notes Folder…',
          click: async () => {
            const listing = await app.chooseLibrary();
            if (listing) app.send('library', listing);
          },
        },
        { label: 'Show Notes Folder in Finder', click: () => shell.openPath(app.library.root) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find Note…', accelerator: 'CmdOrCtrl+Shift+F', click: run({ type: 'focus-search' }) },
      ],
    },
    {
      label: 'Insert',
      submenu: [
        { label: 'Sketch on iPad', accelerator: 'CmdOrCtrl+Shift+D', click: run({ type: 'new-sketch' }) },
        { label: 'Image…', click: run({ type: 'import-image' }) },
        { type: 'separator' },
        { label: 'Task', accelerator: 'CmdOrCtrl+Shift+T', click: format('task') },
        { label: 'Bulleted List', accelerator: 'CmdOrCtrl+Shift+8', click: format('bullet') },
        { label: 'Numbered List', accelerator: 'CmdOrCtrl+Shift+7', click: format('number') },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: format('bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: format('italic') },
        { label: 'Underline', accelerator: 'CmdOrCtrl+U', click: format('underline') },
        { label: 'Highlight', accelerator: 'CmdOrCtrl+Shift+H', click: format('highlight') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+E', click: format('code') },
        { label: 'Math', accelerator: 'CmdOrCtrl+Shift+M', click: format('math') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: format('h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: format('h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: format('h3') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Editor Only', click: run({ type: 'view-mode', mode: 'editor' }) },
        { label: 'Editor and Preview', click: run({ type: 'view-mode', mode: 'split' }) },
        { label: 'Preview Only', click: run({ type: 'view-mode', mode: 'preview' }) },
        { label: 'Cycle Views', accelerator: 'CmdOrCtrl+\\', click: run({ type: 'view-mode', mode: 'cycle' }) },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Alt+S', click: run({ type: 'toggle-sidebar' }) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: run({ type: 'zoom', delta: 0.1 }) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: run({ type: 'zoom', delta: -0.1 }) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: run({ type: 'zoom', delta: 'reset' }) },
        { type: 'separator' },
        { label: 'Appearance', submenu: [appearance('system'), appearance('light'), appearance('dark')] },
        {
          label: 'Dark Paper in Dark Mode',
          type: 'checkbox',
          checked: app.settings.settings.paperFollowsTheme,
          click: (item) => app.updateSettings({ paperFollowsTheme: item.checked }),
        },
        { label: 'iPad…', accelerator: 'CmdOrCtrl+Shift+K', click: run({ type: 'show-devices' }) },
        ...(devTools ? [{ type: 'separator' } as const, { role: 'toggleDevTools' } as const] : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Typst Documentation', click: () => shell.openExternal('https://typst.app/docs/') },
        { label: 'Typink on GitHub', click: () => shell.openExternal(REPO) },
        { type: 'separator' },
        { label: 'Report a Problem…', click: () => shell.openExternal(`${REPO}/issues/new`) },
        { label: 'Show Logs in Finder', click: () => shell.showItemInFolder(logFilePath()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
