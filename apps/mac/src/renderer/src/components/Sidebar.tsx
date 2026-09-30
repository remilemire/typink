import { forwardRef, useMemo, useRef, useState } from 'react';
import type { LibraryListing, NoteMeta } from '@shared/types';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';

interface Props {
  listing: LibraryListing;
  activePath: string | null;
  onOpen(path: string): void;
  onCreateNote(folder: string): void;
  onCreateFolder(): void;
  onRename(path: string, name: string): void;
  onMove(path: string, folder: string): void;
  onTrash(path: string): void;
  onReveal(path: string): void;
  onHide(): void;
  renaming: string | null;
  setRenaming(path: string | null): void;
}

const COLLAPSED_KEY = 'typink.collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const Sidebar = forwardRef<HTMLInputElement, Props>(function Sidebar(props, searchRef) {
  const { listing, activePath } = props;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const notes = q ? listing.notes.filter((n) => n.path.toLowerCase().includes(q)) : listing.notes;
    const byFolder = new Map<string, NoteMeta[]>();
    for (const folder of ['', ...listing.folders]) byFolder.set(folder, []);
    for (const n of notes) byFolder.get(n.folder)?.push(n) ?? byFolder.set(n.folder, [n]);
    return [...byFolder.entries()].filter(([folder, list]) => (q ? list.length > 0 : folder !== '' || list.length > 0));
  }, [listing, query]);

  const toggle = (folder: string) => {
    const next = new Set(collapsed);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  const noteMenu = (e: React.MouseEvent, note: NoteMeta) => {
    e.preventDefault();
    const moveTargets = ['', ...listing.folders].filter((f) => f !== note.folder);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open', onSelect: () => props.onOpen(note.path) },
        { label: 'Rename', onSelect: () => props.setRenaming(note.path) },
        { label: 'Show in Finder', onSelect: () => props.onReveal(note.path) },
        ...(moveTargets.length
          ? ([{ separator: true }, { heading: 'Move to' }] as MenuItem[]).concat(
              moveTargets.map((f) => ({ label: f || 'Notes folder (top level)', onSelect: () => props.onMove(note.path, f) })),
            )
          : []),
        { separator: true },
        { label: 'Move to Trash', danger: true, onSelect: () => props.onTrash(note.path) },
      ],
    });
  };

  const folderMenu = (e: React.MouseEvent, folder: string) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New Note Here', onSelect: () => props.onCreateNote(folder) },
        { label: 'Rename Notebook', onSelect: () => props.setRenaming(folder) },
        { label: 'Show in Finder', onSelect: () => props.onReveal(folder) },
        { separator: true },
        { label: 'Move Notebook to Trash', danger: true, onSelect: () => props.onTrash(folder) },
      ],
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-drag">
        <button className="icon-button" onClick={props.onHide} title="Hide sidebar (⌥⌘S)">
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          placeholder="Search notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'Enter') {
              const first = groups.flatMap(([, list]) => list)[0];
              if (first) props.onOpen(first.path);
            }
          }}
        />
      </div>
      <nav className="note-list">
        {groups.map(([folder, list]) => (
          <div key={folder || '__root'}>
            {folder && (
              <div
                className={`group-header${collapsed.has(folder) && !query ? ' collapsed' : ''}`}
                onClick={() => toggle(folder)}
                onContextMenu={(e) => folderMenu(e, folder)}
              >
                <span className="chevron">
                  <Icon name="chevron" size={12} />
                </span>
                {props.renaming === folder ? (
                  <RenameInput
                    initial={folder.split('/').pop()!}
                    onDone={(name) => {
                      props.setRenaming(null);
                      if (name) props.onRename(folder, name);
                    }}
                  />
                ) : (
                  <span>{folder}</span>
                )}
                <span className="count">{list.length || ''}</span>
              </div>
            )}
            {!(collapsed.has(folder) && !query) &&
              list.map((note) => (
                <div
                  key={note.path}
                  className={`note-item${note.path === activePath ? ' active' : ''}`}
                  onClick={() => props.onOpen(note.path)}
                  onContextMenu={(e) => noteMenu(e, note)}
                  style={folder ? undefined : { paddingLeft: 10 }}
                >
                  {props.renaming === note.path ? (
                    <RenameInput
                      initial={note.name}
                      onDone={(name) => {
                        props.setRenaming(null);
                        if (name && name !== note.name) props.onRename(note.path, name);
                      }}
                    />
                  ) : (
                    <span className="name">{note.name}</span>
                  )}
                  <span className="meta">{relativeTime(note.mtime)}</span>
                </div>
              ))}
          </div>
        ))}
        {listing.notes.length === 0 && <div className="empty-state" style={{ padding: 24 }}>No notes yet</div>}
      </nav>
      <div className="sidebar-footer">
        <button className="icon-button" onClick={() => props.onCreateNote(currentFolder(activePath))} title="New note (⌘N)">
          <Icon name="plus" /> New note
        </button>
        <div className="spacer" />
        <button className="icon-button" onClick={props.onCreateFolder} title="New notebook (⇧⌘N)">
          <Icon name="folderPlus" />
        </button>
      </div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  );
});

function currentFolder(path: string | null): string {
  if (!path) return 'Notes';
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  // Enter unmounts the input, which also fires blur; only report once.
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim() || null);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
