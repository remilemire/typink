import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpenedNote, SketchState } from '@shared/api';
import { DEFAULT_SETTINGS, newId, parseHeader } from '@shared/header';
import type {
  AppSettings,
  Diagnostic,
  ExportFormat,
  ExportOptions,
  HubStatus,
  LibraryListing,
  NoteSettings,
  PreviewResult,
  RendererCommand,
  ViewMode,
} from '@shared/types';
import { DevicesPopover } from './components/DevicesPopover';
import { ExportDialog } from './components/ExportDialog';
import { NoteSettingsPopover } from './components/NoteSettingsPopover';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { Toasts, useToasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import type { EditorCallbacks, SlashAction } from './editor/callbacks';
import { Editor, type EditorHandle } from './editor/Editor';

const api = window.typink;

interface OpenNote {
  path: string;
  text: string;
  /** Bumps whenever the editor must load `text` as a fresh document. */
  key: string;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [library, setLibrary] = useState<LibraryListing | null>(null);
  const [dark, setDark] = useState(false);
  const [note, setNote] = useState<OpenNote | null>(null);
  const [noteSettings, setNoteSettings] = useState<NoteSettings | null>(null);
  const [good, setGood] = useState<PreviewResult | null>(null);
  const [failed, setFailed] = useState<PreviewResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [sketches, setSketches] = useState<Record<string, SketchState>>({});
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [editorFraction, setEditorFraction] = useState(0.5);
  const fitScale = useRef(1);
  const errorTimer = useRef<number | null>(null);
  const currentPage = useRef(1);
  const editor = useRef<EditorHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const { toasts, push, dismiss } = useToasts();

  const notePath = note?.path ?? null;
  const notePathRef = useRef(notePath);
  notePathRef.current = notePath;
  const viewMode: ViewMode = settings?.viewMode ?? 'split';
  const deviceConnected = hub?.devices.some((d) => d.connected) ?? false;

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    void api.updateSettings(patch);
  }, []);

  // ---- notes -----------------------------------------------------------------------

  const pending = useRef<{ path: string; text: string } | null>(null);
  const pendingTimer = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) void api.updateNote(p.path, p.text);
  }, []);

  const loadNote = useCallback((opened: OpenedNote) => {
    setNote({ path: opened.path, text: opened.text, key: `${opened.path}#${Date.now()}` });
    setNoteSettings(parseHeader(opened.text)?.settings ?? null);
    setSketches(opened.sketches);
  }, []);

  const openNote = useCallback(
    async (path: string) => {
      if (path === notePathRef.current) return;
      flushPending();
      try {
        const opened = await api.openNote(path);
        setGood(null);
        setFailed(null);
        setDiagnostics([]);
        loadNote(opened);
      } catch (err) {
        push(`Couldn't open ${path}: ${(err as Error).message}`);
      }
    },
    [flushPending, loadNote, push],
  );

  const onEditorChange = useCallback(
    (text: string) => {
      const path = notePathRef.current;
      if (!path) return;
      pending.current = { path, text };
      if (!pendingTimer.current) pendingTimer.current = window.setTimeout(flushPending, 60);
      const next = parseHeader(text)?.settings ?? null;
      setNoteSettings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    },
    [flushPending],
  );

  const createNote = useCallback(
    async (folder: string) => {
      try {
        const meta = await api.createNote(folder, 'Untitled');
        await openNote(meta.path);
        setRenaming(meta.path);
      } catch (err) {
        push((err as Error).message);
      }
    },
    [openNote, push],
  );

  const createFolder = useCallback(async () => {
    const rel = await api.createFolder('New Notebook');
    setRenaming(rel);
  }, []);

  const renameEntry = useCallback(
    async (path: string, name: string) => {
      try {
        const next = await api.renameEntry(path, name);
        if (notePathRef.current && (notePathRef.current === path || notePathRef.current.startsWith(`${path}/`))) {
          const moved = next + notePathRef.current.slice(path.length);
          setNote((n) => (n ? { ...n, path: moved } : n));
        }
      } catch (err) {
        push((err as Error).message);
      }
    },
    [push],
  );

  const moveEntry = useCallback(
    async (path: string, folder: string) => {
      try {
        const next = await api.moveEntry(path, folder);
        if (notePathRef.current === path) setNote((n) => (n ? { ...n, path: next } : n));
      } catch (err) {
        push((err as Error).message);
      }
    },
    [push],
  );

  const trashEntry = useCallback(
    async (path: string) => {
      await api.trashEntry(path);
      if (notePathRef.current && (notePathRef.current === path || notePathRef.current.startsWith(`${path}/`))) {
        setNote(null);
        setGood(null);
        setFailed(null);
      }
      push('Moved to the Typink trash (.typink/trash)');
    },
    [push],
  );

  // ---- sketches & images ------------------------------------------------------------

  const insertSketch = useCallback(
    async (opts: { on?: string; beside?: boolean } = {}) => {
      if (!notePathRef.current) return;
      if (!editor.current || !parseHeader(editor.current.getText())) {
        push('Sketches need a Typink note: click “Make it a Typink note” at the top of the editor first.');
        return;
      }
      const { id, snippet } = await api.newSketch({ on: opts.on, open: true });
      setSketches((s) => ({ ...s, [id]: { rev: 0, n: 0 } }));
      editor.current.insertBlock(opts.beside ? `#cols[\n  \n][\n  ${snippet}\n]` : snippet);
      flushPending();
      const sent = await api.editSketch(id);
      if (!sent) push('Sketch added. Connect your iPad to draw it.', { label: 'Connect', run: () => setDevicesOpen(true) });
    },
    [flushPending, push],
  );

  const importImages = useCallback(async () => {
    const paths = await api.pickAttachments();
    for (const p of paths) editor.current?.insertBlock(`#figure(image("${p}", width: 80%))`);
  }, []);

  const drawOnImage = useCallback(async () => {
    const [path] = await api.pickAttachments();
    if (path) await insertSketch({ on: path });
  }, [insertSketch]);

  const onImageFiles = useCallback(async (files: File[]) => {
    const paths: string[] = [];
    for (const file of files) {
      const ext = EXTENSIONS[file.type] ?? file.name.split('.').pop() ?? 'png';
      paths.push(await api.importAttachment(new Uint8Array(await file.arrayBuffer()), ext));
    }
    return paths;
  }, []);

  /** `image("/attachments/x")` → `sketch("id", on: "/attachments/x")`, then open it on the iPad. */
  const convertImageToSketch = useCallback(
    async (path: string) => {
      if (!editor.current || !parseHeader(editor.current.getText())) return;
      const { id } = await api.newSketch({ on: path });
      setSketches((s) => ({ ...s, [id]: { rev: 0, n: 0 } }));
      if (!editor.current.replaceFirst(`image("${path}"`, `sketch("${id}", on: "${path}"`)) return;
      flushPending();
      const sent = await api.editSketch(id);
      if (!sent) push('Converted to a sketch. Connect your iPad to draw on it.', { label: 'Connect', run: () => setDevicesOpen(true) });
    },
    [flushPending, push],
  );

  const editSketch = useCallback(
    async (id: string) => {
      flushPending();
      const sent = await api.editSketch(id);
      if (!sent) setDevicesOpen(true);
    },
    [flushPending],
  );

  const callbacks = useMemo<EditorCallbacks>(
    () => ({
      openNoteSettings: (anchor) => setSettingsAnchor(anchor),
      convertToTypinkNote: () => editor.current?.setHeader({ id: newId('n'), ...DEFAULT_SETTINGS }),
      editSketch: (id) => void editSketch(id),
      drawOnImage: (path) => void convertImageToSketch(path),
      slashAction: (action: SlashAction) => {
        if (action === 'sketch') void insertSketch();
        else if (action === 'sketch-beside') void insertSketch({ beside: true });
        else if (action === 'image') void importImages();
        else void drawOnImage();
      },
    }),
    [editSketch, insertSketch, importImages, drawOnImage, convertImageToSketch],
  );

  const changeNoteSettings = useCallback(
    (patch: Partial<NoteSettings>) => {
      if (!noteSettings) return;
      editor.current?.setHeader({ ...noteSettings, ...patch });
    },
    [noteSettings],
  );

  const runExport = useCallback(
    async (options: ExportOptions) => {
      const path = notePathRef.current;
      setExporting(null);
      if (!path) return;
      flushPending();
      try {
        const result = await api.exportNote(path, options);
        if (!result) return;
        const first = result.files[0];
        push(
          result.files.length === 1 ? `Exported ${first.split('/').pop()}` : `Exported ${result.files.length} pages`,
          { label: 'Show in Finder', run: () => void api.revealFile(first) },
        );
      } catch (err) {
        push((err as Error).message);
      }
    },
    [flushPending, push],
  );

  // ---- main-process events ---------------------------------------------------------------

  const commandRef = useRef<(cmd: RendererCommand) => void>(() => {});
  commandRef.current = (cmd) => {
    switch (cmd.type) {
      case 'new-note':
        return void createNote(notePath?.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : 'Notes');
      case 'new-folder':
        return void createFolder();
      case 'insert':
        return cmd.block ? editor.current?.insertBlock(cmd.text) : editor.current?.insertText(cmd.text);
      case 'replace':
        return void editor.current?.replaceFirst(cmd.from, cmd.to);
      case 'format':
        return editor.current?.format(cmd.action);
      case 'view-mode': {
        const order: ViewMode[] = ['editor', 'split', 'preview'];
        const mode = cmd.mode === 'cycle' ? order[(order.indexOf(viewMode) + 1) % 3] : cmd.mode;
        return updateSettings({ viewMode: mode });
      }
      case 'toggle-sidebar':
        return updateSettings({ sidebar: !settings?.sidebar });
      case 'export':
        return notePath ? setExporting(cmd.format) : undefined;
      case 'new-sketch':
        return void insertSketch();
      case 'import-image':
        return void importImages();
      case 'show-devices':
        return setDevicesOpen(true);
      case 'focus-search':
        updateSettings({ sidebar: true });
        return void setTimeout(() => search.current?.focus(), 0);
      case 'zoom': {
        const current = zoom === 'fit' ? fitScale.current : zoom;
        return setZoom(cmd.delta === 'reset' ? 'fit' : Math.min(3, Math.max(0.3, current * (1 + cmd.delta))));
      }
      case 'toast':
        return push(cmd.message);
    }
  };

  useEffect(() => {
    const offs = [
      api.on('command', (cmd) => commandRef.current(cmd)),
      api.on('library', setLibrary),
      api.on('appearance', ({ dark }) => setDark(dark)),
      api.on('hub', setHub),
      api.on('note-external', (opened) => {
        if (opened.path === notePathRef.current) loadNote(opened);
      }),
      api.on('sketch-updated', ({ id, rev, n }) => setSketches((s) => ({ ...s, [id]: { rev, n } }))),
      api.on('preview', (result) => {
        if (result.notePath !== notePathRef.current) return;
        const mine = result.diagnostics.filter((d) => d.path === result.notePath);
        if (result.ok && result.svg) {
          if (errorTimer.current) window.clearTimeout(errorTimer.current);
          errorTimer.current = null;
          setGood(result);
          setFailed(null);
          setDiagnostics(mine);
          return;
        }
        // Errors from half-typed syntax (like "/" opening the command menu) usually
        // vanish a keystroke later; only show them once they stick around.
        if (errorTimer.current) window.clearTimeout(errorTimer.current);
        errorTimer.current = window.setTimeout(() => {
          errorTimer.current = null;
          if (result.notePath !== notePathRef.current) return;
          setFailed(result);
          setDiagnostics(mine);
        }, 900);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [loadNote]);

  useEffect(() => {
    void api.bootstrap().then(async (boot) => {
      setSettings(boot.settings);
      setLibrary(boot.library);
      setDark(boot.dark);
      const paths = boot.library.notes.map((n) => n.path);
      const initial = boot.settings.lastNote && paths.includes(boot.settings.lastNote) ? boot.settings.lastNote : paths[0];
      if (initial) await openNote(initial);
      void api.hubStatus().then(setHub);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  // ---- layout ---------------------------------------------------------------------------

  const workspace = useRef<HTMLDivElement>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = workspace.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => setEditorFraction(Math.min(0.75, Math.max(0.25, (ev.clientX - rect.left) / rect.width)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!settings || !library) return null;
  const showEditor = viewMode !== 'preview';
  const showPreview = viewMode !== 'editor';

  return (
    <div className="app">
      {settings.sidebar && (
        <Sidebar
          ref={search}
          listing={library}
          activePath={notePath}
          onOpen={openNote}
          onCreateNote={createNote}
          onCreateFolder={createFolder}
          onRename={renameEntry}
          onMove={moveEntry}
          onTrash={trashEntry}
          onReveal={(p) => void api.revealEntry(p)}
          onHide={() => updateSettings({ sidebar: false })}
          renaming={renaming}
          setRenaming={setRenaming}
        />
      )}
      <main className="main">
        <TopBar
          sidebar={settings.sidebar}
          onShowSidebar={() => updateSettings({ sidebar: true })}
          notePath={notePath}
          settings={noteSettings}
          onSettings={changeNoteSettings}
          onMoreSettings={setSettingsAnchor}
          viewMode={viewMode}
          onViewMode={(mode) => updateSettings({ viewMode: mode })}
          hub={hub}
          onDevices={() => setDevicesOpen(true)}
          onExport={() => setExporting('pdf')}
        />
        {note ? (
          <div className="workspace" ref={workspace}>
            {showEditor && (
              <section className="pane-editor" style={showPreview ? { width: `${editorFraction * 100}%` } : { flex: 1 }}>
                <Editor
                  ref={editor}
                  docKey={note.key}
                  text={note.text}
                  dark={dark}
                  diagnostics={diagnostics}
                  sketches={sketches}
                  callbacks={callbacks}
                  onChange={onEditorChange}
                  onImageFiles={onImageFiles}
                />
              </section>
            )}
            {showEditor && showPreview && <div className="divider" onMouseDown={startResize} />}
            {showPreview && (
              <Preview
                result={good}
                failed={failed}
                zoom={zoom}
                showAnnotations
                deviceConnected={deviceConnected}
                onEditSketch={(id) => void editSketch(id)}
                onRevealSketch={(id) => {
                  if (showEditor) editor.current?.jumpToText(`#sketch("${id}"`);
                }}
                onJumpToText={(text) => {
                  if (showEditor) editor.current?.jumpToProse(text);
                }}
                onJumpToError={(d) => {
                  if (d.range && d.path === notePath) editor.current?.jumpToLine(d.range.startLine);
                }}
                onPageChange={(p) => (currentPage.current = p)}
                onFitScale={(s) => (fitScale.current = s)}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div>
              <h2>No note open</h2>
              <p>Pick a note on the left or create a new one.</p>
              <button className="primary-button" onClick={() => void createNote('Notes')}>
                New note
              </button>
            </div>
          </div>
        )}
      </main>

      {settingsAnchor && noteSettings && (
        <NoteSettingsPopover anchor={settingsAnchor} settings={noteSettings} onChange={changeNoteSettings} onClose={() => setSettingsAnchor(null)} />
      )}
      {devicesOpen && <DevicesPopover hub={hub} onRevoke={(id) => void api.revokeDevice(id)} onClose={() => setDevicesOpen(false)} />}
      {exporting && (
        <ExportDialog
          initialFormat={exporting}
          currentPage={currentPage.current}
          pageCount={good?.pages.length ?? 1}
          hasAnnotations={(good?.annotations.length ?? 0) > 0}
          onExport={(o) => void runExport(o)}
          onClose={() => setExporting(null)}
        />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
