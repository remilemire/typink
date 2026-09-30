// A live thumbnail and an "Edit on iPad" button under every #sketch("…") line.

import { type EditorState, type Extension, Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { editorCallbacks } from './callbacks';

export interface SketchInfo {
  rev: number;
  /** Number of strokes; 0 means the sketch is still empty. */
  n: number;
}

export const setSketchInfo = StateEffect.define<Record<string, SketchInfo>>();

/** Whether thumbnails should use the dark rendering. */
export const darkThumbnails = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

const SKETCH_CALL = /#sketch\(\s*"([\w-]+)"/g;

class SketchWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly info: SketchInfo | undefined,
    readonly dark: boolean,
  ) {
    super();
  }

  eq(o: SketchWidget) {
    return o.id === this.id && o.dark === this.dark && o.info?.rev === this.info?.rev && o.info?.n === this.info?.n;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'sketch-widget';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (this.info && this.info.n > 0) {
      const img = document.createElement('img');
      img.src = `typink://ink/${this.id}${this.dark ? '.dark' : ''}.svg?rev=${this.info.rev}`;
      img.alt = 'Sketch';
      img.draggable = false;
      thumb.append(img);
    } else {
      thumb.textContent = this.info ? 'Empty sketch' : 'Sketch';
    }
    const button = document.createElement('button');
    button.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit on iPad';
    const edit = (e: Event) => {
      e.preventDefault();
      view.state.facet(editorCallbacks).editSketch(this.id);
    };
    button.onmousedown = edit;
    thumb.ondblclick = edit;
    // Keep the text cursor out of the widget.
    wrap.onmousedown = (e) => e.preventDefault();
    wrap.append(thumb, button);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

interface SketchState {
  info: Record<string, SketchInfo>;
  decorations: DecorationSet;
}

function build(state: EditorState, info: Record<string, SketchInfo>): DecorationSet {
  const dark = state.facet(darkThumbnails);
  const text = state.doc.toString();
  const widgets = [];
  for (const m of text.matchAll(SKETCH_CALL)) {
    const line = state.doc.lineAt(m.index!);
    widgets.push(
      Decoration.widget({ widget: new SketchWidget(m[1], info[m[1]], dark), block: true, side: 1 }).range(line.to),
    );
  }
  return Decoration.set(widgets, true);
}

const sketchField = StateField.define<SketchState>({
  create: (state) => ({ info: {}, decorations: build(state, {}) }),
  update(value, tr) {
    let info = value.info;
    for (const e of tr.effects) if (e.is(setSketchInfo)) info = { ...info, ...e.value };
    const themeChanged = tr.startState.facet(darkThumbnails) !== tr.state.facet(darkThumbnails);
    if (info === value.info && !themeChanged) {
      if (!tr.docChanged) return value;
      // Rebuild only when an edit could add or remove a sketch call.
      let relevant = false;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (relevant) return;
        const removed = tr.startState.doc.sliceString(Math.max(0, fromA - 12), toA + 12);
        relevant = removed.includes('sketch') || inserted.toString().includes('sketch') || inserted.lines > 1;
      });
      if (!relevant) return { info, decorations: value.decorations.map(tr.changes) };
    }
    return { info, decorations: build(tr.state, info) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

export function sketchExtension(): Extension {
  return sketchField;
}
