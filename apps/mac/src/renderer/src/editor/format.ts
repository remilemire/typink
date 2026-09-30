// Formatting commands for the Format/Insert menus (⌘B, ⌘I, ⌘1…).

import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { FormatAction } from '@shared/types';

const WRAPS: Partial<Record<FormatAction, [string, string]>> = {
  bold: ['*', '*'],
  italic: ['_', '_'],
  code: ['`', '`'],
  math: ['$', '$'],
  underline: ['#underline[', ']'],
  highlight: ['#hl[', ']'],
};

const LINE_PREFIXES: Partial<Record<FormatAction, string>> = {
  h1: '= ',
  h2: '== ',
  h3: '=== ',
  bullet: '- ',
  number: '+ ',
};

const ANY_PREFIX = /^(\s*)(=+ |- |\+ )?/;

export function applyFormat(view: EditorView, action: FormatAction): void {
  const wrap = WRAPS[action];
  if (wrap) return toggleWrap(view, wrap[0], wrap[1]);
  const prefix = LINE_PREFIXES[action];
  if (prefix) return toggleLinePrefix(view, prefix);
  if (action === 'task') return toggleTask(view);
}

function toggleWrap(view: EditorView, open: string, close: string): void {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const { from, to } = range;
      const isWrapped =
        state.sliceDoc(from - open.length, from) === open && state.sliceDoc(to, to + close.length) === close;
      if (isWrapped) {
        return {
          changes: [
            { from: from - open.length, to: from },
            { from: to, to: to + close.length },
          ],
          range: EditorSelection.range(from - open.length, to - open.length),
        };
      }
      return {
        changes: [
          { from, insert: open },
          { from: to, insert: close },
        ],
        range: EditorSelection.range(from + open.length, to + open.length),
      };
    }),
    { userEvent: 'input.format', scrollIntoView: true },
  );
  view.focus();
}

function selectedLines(view: EditorView) {
  const { state } = view;
  const lines = new Map<number, { from: number; text: string }>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      const line = state.doc.line(n);
      lines.set(line.from, { from: line.from, text: line.text });
    }
  }
  return [...lines.values()];
}

function toggleLinePrefix(view: EditorView, prefix: string): void {
  const lines = selectedLines(view);
  const allHave = lines.every((l) => l.text.replace(/^\s*/, '').startsWith(prefix));
  const changes = lines.map((l) => {
    const m = l.text.match(ANY_PREFIX)!;
    const indent = m[1];
    const existing = m[2] ?? '';
    return { from: l.from + indent.length, to: l.from + indent.length + existing.length, insert: allHave ? '' : prefix };
  });
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  view.focus();
}

const TASK = /^(\s*)#task(\(done: true\))?\[(.*)\]\s*$/;

/** Plain line → task → done task → plain line. */
function toggleTask(view: EditorView): void {
  const changes = selectedLines(view).map((l) => {
    const m = l.text.match(TASK);
    let insert: string;
    if (!m) {
      const indent = l.text.match(/^\s*/)![0];
      insert = `${indent}#task[${l.text.slice(indent.length).replace(/^(- |\+ )/, '')}]`;
    } else if (!m[2]) insert = `${m[1]}#task(done: true)[${m[3]}]`;
    else insert = `${m[1]}${m[3]}`;
    return { from: l.from, to: l.from + l.text.length, insert };
  });
  view.dispatch({ changes, userEvent: 'input.format' });
  view.focus();
}
