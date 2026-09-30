import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, LanguageSupport } from '@codemirror/language';
import { type Diagnostic as CmDiagnostic, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from '@codemirror/view';
import {
  typst_lezer,
  typstCompletionSource,
  typstLezerFoldService,
  typstLezerIndentService,
  typstLezerListKeymap,
} from 'codemirror-lang-typst/lezer';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { serializeHeader } from '@shared/header';
import type { Diagnostic, FormatAction, NoteSettings } from '@shared/types';
import { type EditorCallbacks, editorCallbacks } from './callbacks';
import { applyFormat } from './format';
import { headerEdit, headerEnd, headerExtension } from './header';
import { imageExtension } from './images';
import { darkThumbnails, type SketchInfo, setSketchInfo, sketchExtension } from './sketches';
import { slashCompletions } from './slash';
import { editorTheme } from './theme';

export interface EditorHandle {
  /** Inserts text on its own line at the cursor. */
  insertBlock(text: string): void;
  insertText(text: string): void;
  format(action: FormatAction): void;
  setHeader(settings: NoteSettings): void;
  /** Replaces the first occurrence of `find`; false if not found. */
  replaceFirst(find: string, replace: string): boolean;
  jumpToLine(line: number): void;
  /** Selects the first occurrence of `needle` and scrolls to it. */
  jumpToText(needle: string): boolean;
  /** Finds rendered text in the source (markup between words is ignored) and puts the cursor there. */
  jumpToProse(text: string): boolean;
  focus(): void;
  getText(): string;
}

interface Props {
  /** Changing the key loads `text` as a fresh document (new note, external edit). */
  docKey: string;
  text: string;
  dark: boolean;
  diagnostics: Diagnostic[];
  sketches: Record<string, SketchInfo>;
  callbacks: EditorCallbacks;
  onChange(text: string): void;
  onImageFiles(files: File[]): Promise<string[]>;
}

// Typst language support without the package's syntax linter: compile
// diagnostics from the real compiler are shown instead.
function typstSupport() {
  const base = typst_lezer();
  return new LanguageSupport(base.language, [
    base.language.data.of({ autocomplete: typstCompletionSource }),
    base.language.data.of({ autocomplete: slashCompletions }),
    typstLezerFoldService,
    typstLezerIndentService,
    typstLezerListKeymap,
  ]);
}

function toCmDiagnostics(state: EditorState, diagnostics: Diagnostic[]): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const d of diagnostics) {
    if (!d.range) continue;
    const pos = (line: number, col: number) => {
      const n = Math.min(Math.max(1, line + 1), state.doc.lines);
      const l = state.doc.line(n);
      return Math.min(l.from + col, l.to);
    };
    let from = pos(d.range.startLine, d.range.startCol);
    let to = pos(d.range.endLine, d.range.endCol);
    if (to <= from) to = Math.min(from + 1, state.doc.length);
    if (from === to && from > 0) from -= 1;
    out.push({ from, to, severity: d.severity, message: d.message });
  }
  return out;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const theme = useRef(new Compartment()).current;
  const hooks = useRef(new Compartment()).current;

  const createState = (text: string) =>
    EditorState.create({
      doc: text,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ icons: false, activateOnTyping: true }),
        rectangularSelection(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        placeholder('Start typing… (type / for formatting)'),
        typstSupport(),
        headerExtension(),
        sketchExtension(),
        imageExtension(),
        theme.of(editorTheme(propsRef.current.dark)),
        hooks.of([editorCallbacks.of(propsRef.current.callbacks), darkThumbnails.of(propsRef.current.dark)]),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) propsRef.current.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event, view) => handleFiles(event.clipboardData?.files, view, null, event),
          drop: (event, view) => handleFiles(event.dataTransfer?.files, view, view.posAtCoords(event), event),
        }),
      ],
    });

  const handleFiles = (list: FileList | undefined | null, view: EditorView, at: number | null, event: Event) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (files.length === 0) return false;
    event.preventDefault();
    void propsRef.current.onImageFiles(files).then((paths) => {
      if (at !== null) view.dispatch({ selection: { anchor: at } });
      for (const p of paths) insertBlock(view, `#figure(image("${p}", width: 80%))`);
    });
    return true;
  };

  useEffect(() => {
    const view = new EditorView({ state: createState(props.text), parent: host.current! });
    viewRef.current = view;
    view.dispatch({ effects: setSketchInfo.of(props.sketches) });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different note (or an external edit): start a fresh document and undo history.
  const loadedKey = useRef(props.docKey);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || loadedKey.current === props.docKey) return;
    loadedKey.current = props.docKey;
    view.setState(createState(props.text));
    view.dispatch({ effects: setSketchInfo.of(propsRef.current.sketches) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.docKey]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        theme.reconfigure(editorTheme(props.dark)),
        hooks.reconfigure([editorCallbacks.of(props.callbacks), darkThumbnails.of(props.dark)]),
      ],
    });
  }, [props.dark, props.callbacks, theme, hooks]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, props.diagnostics)));
  }, [props.diagnostics]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setSketchInfo.of(props.sketches) });
  }, [props.sketches]);

  useImperativeHandle(
    ref,
    () => ({
      insertBlock: (text) => viewRef.current && insertBlock(viewRef.current, text),
      insertText: (text) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
        view.focus();
      },
      format: (action) => viewRef.current && applyFormat(viewRef.current, action),
      setHeader: (settings) => {
        const view = viewRef.current;
        if (!view) return;
        const end = headerEnd(view.state);
        const to = end < 0 ? 0 : Math.min(end + 1, view.state.doc.length);
        let insert = serializeHeader(settings);
        if (end >= 0 && to === view.state.doc.length && view.state.doc.sliceString(end, to) !== '\n') {
          insert = insert.slice(0, -1);
        }
        view.dispatch({ changes: { from: 0, to, insert }, annotations: headerEdit.of(true) });
      },
      replaceFirst: (find, replace) => {
        const view = viewRef.current;
        if (!view) return false;
        const at = view.state.doc.toString().indexOf(find);
        if (at < 0) return false;
        view.dispatch({ changes: { from: at, to: at + find.length, insert: replace }, userEvent: 'input' });
        return true;
      },
      jumpToLine: (line) => {
        const view = viewRef.current;
        if (!view) return;
        const l = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
        view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
        view.focus();
      },
      jumpToText: (needle) => {
        const view = viewRef.current;
        if (!view) return false;
        const at = view.state.doc.toString().indexOf(needle);
        if (at < 0) return false;
        view.dispatch({ selection: { anchor: at, head: at + needle.length }, scrollIntoView: true });
        view.focus();
        return true;
      },
      jumpToProse: (text) => {
        const view = viewRef.current;
        if (!view) return false;
        const words = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 6) ?? [];
        const doc = view.state.doc.toString();
        // Try the first six words, then fewer, allowing Typst markup between them.
        for (let n = words.length; n >= Math.min(2, words.length) && n > 0; n--) {
          const escaped = words.slice(0, n).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const m = new RegExp(escaped.join('[^\\p{L}\\p{N}]{1,12}'), 'u').exec(doc);
          if (m) {
            view.dispatch({ selection: { anchor: m.index }, scrollIntoView: true });
            view.focus();
            return true;
          }
        }
        return false;
      },
      focus: () => viewRef.current?.focus(),
      getText: () => viewRef.current?.state.doc.toString() ?? '',
    }),
    [],
  );

  return <div className="editor-host" ref={host} />;
});

/** Puts `text` on its own line (replacing an empty line) and leaves the cursor on a fresh line below it. */
function insertBlock(view: EditorView, text: string): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === '';
  const from = empty ? line.from : line.to;
  const insert = `${empty ? '' : '\n'}${text}\n`;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}
