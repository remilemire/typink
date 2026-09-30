// Shows the two app-managed header lines as a compact settings chip, keeps them
// read-only for typing, and lets the app rewrite them (paper/template pickers).

import { Annotation, EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { parseHeader } from '@shared/header';
import type { NoteSettings } from '@shared/types';
import { editorCallbacks } from './callbacks';

/** Marks transactions allowed to modify the header. */
export const headerEdit = Annotation.define<boolean>();

const TEMPLATE_LABEL: Record<string, string> = { blank: 'Blank', lined: 'Lined', grid: 'Grid', dotted: 'Dotted' };
const PAPER_LABEL: Record<string, string> = { a4: 'A4', 'us-letter': 'Letter', endless: 'Endless' };
const FONT_LABEL: Record<string, string> = { serif: 'Serif', sans: 'Sans', modern: 'Modern', mono: 'Mono' };

export function describeSettings(s: NoteSettings): string {
  return [
    TEMPLATE_LABEL[s.template] ?? s.template,
    PAPER_LABEL[s.paper] ?? s.paper,
    FONT_LABEL[s.font] ?? s.font,
    `${s.size}pt`,
  ].join(' · ');
}

/** End offset of the header's second line, or -1 when the note has none. */
export function headerEnd(state: EditorState): number {
  if (state.doc.lines < 2) return -1;
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 2000));
  return parseHeader(head.endsWith('\n') ? head : `${head}\n`) ? state.doc.line(2).to : -1;
}

class HeaderChip extends WidgetType {
  constructor(readonly label: string | null) {
    super();
  }

  eq(other: HeaderChip) {
    return other.label === this.label;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    const chip = document.createElement('button');
    chip.className = 'header-chip';
    if (this.label) {
      chip.textContent = this.label;
      chip.title = 'Page settings';
      chip.onmousedown = (e) => {
        e.preventDefault();
        view.state.facet(editorCallbacks).openNoteSettings(chip.getBoundingClientRect());
      };
    } else {
      chip.innerHTML = '<span class="plain">Plain Typst file</span> · Make it a Typink note';
      chip.title = 'Adds the Typink header so you get paper templates and sketches';
      chip.onmousedown = (e) => {
        e.preventDefault();
        view.state.facet(editorCallbacks).convertToTypinkNote();
      };
    }
    wrap.onmousedown = (e) => e.preventDefault();
    wrap.append(chip);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const end = headerEnd(state);
  if (end < 0) {
    return Decoration.set([Decoration.widget({ widget: new HeaderChip(null), block: true, side: -1 }).range(0)]);
  }
  const parsed = parseHeader(`${state.doc.sliceString(0, end)}\n`)!;
  return Decoration.set([
    Decoration.replace({ widget: new HeaderChip(describeSettings(parsed.settings)), block: true }).range(0, end),
  ]);
}

const headerField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (!tr.docChanged) return value;
    // Only the first lines matter; skip the rebuild for edits further down.
    let touched = false;
    tr.changes.iterChangedRanges((from) => {
      if (from <= tr.startState.doc.line(Math.min(3, tr.startState.doc.lines)).to) touched = true;
    });
    return touched ? build(tr.state) : value.map(tr.changes);
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

// Typing can't change the header; the app rewrites it with the `headerEdit` annotation.
const protectHeader = EditorState.changeFilter.of((tr) => {
  if (tr.annotation(headerEdit)) return true;
  const end = headerEnd(tr.startState);
  return end < 0 ? true : [0, end];
});

export function headerExtension(): Extension {
  return [headerField, protectHeader];
}
