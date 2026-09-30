import { Facet } from '@codemirror/state';

export type SlashAction = 'sketch' | 'sketch-beside' | 'image' | 'draw-on-image';

/** Hooks from editor widgets back into the app. */
export interface EditorCallbacks {
  openNoteSettings(anchor: DOMRect): void;
  convertToTypinkNote(): void;
  editSketch(id: string): void;
  drawOnImage(path: string): void;
  slashAction(action: SlashAction): void;
}

const noop: EditorCallbacks = {
  openNoteSettings() {},
  convertToTypinkNote() {},
  editSketch() {},
  drawOnImage() {},
  slashAction() {},
};

export const editorCallbacks = Facet.define<EditorCallbacks, EditorCallbacks>({
  combine: (values) => values[0] ?? noop,
});
