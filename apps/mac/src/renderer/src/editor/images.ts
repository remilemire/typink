// A small "Draw on it" chip after every image("/attachments/…") call: turns the
// image into a sketch with the picture as its background and opens it on the iPad.

import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { editorCallbacks } from './callbacks';

const IMAGE_CALL = /\bimage\(\s*"(\/attachments\/[\w.-]+)"/g;

class DrawOnChip extends WidgetType {
  constructor(readonly path: string) {
    super();
  }

  eq(other: DrawOnChip) {
    return other.path === this.path;
  }

  toDOM(view: EditorView) {
    const chip = document.createElement('button');
    chip.className = 'inline-chip';
    chip.textContent = '✎ Draw on it';
    chip.title = 'Turn this image into a sketch and draw on it with your iPad';
    chip.onmousedown = (e) => {
      e.preventDefault();
      view.state.facet(editorCallbacks).drawOnImage(this.path);
    };
    return chip;
  }

  ignoreEvent() {
    return true;
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(IMAGE_CALL)) {
      const line = view.state.doc.lineAt(from + m.index!);
      if (line.text.includes('sketch(')) continue;
      builder.add(line.to, line.to, Decoration.widget({ widget: new DrawOnChip(m[1]), side: 1 }));
    }
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function imageExtension(): Extension {
  return plugin;
}
