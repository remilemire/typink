import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { typstTags } from 'codemirror-lang-typst/lezer';

// Layout and chrome come from CSS variables, so one view theme serves both modes.
const viewTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-foldPlaceholder': { background: 'var(--hover)', border: 'none', color: 'var(--text-2)', padding: '0 6px' },
  '.cm-tooltip': {
    border: 'none',
    borderRadius: '9px',
    background: 'var(--surface)',
    boxShadow: 'var(--popover-shadow)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '13px', maxHeight: '21em', padding: '4px', minWidth: '240px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', borderRadius: '6px', lineHeight: '1.45' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-strong)', color: 'white' },
  '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', opacity: '0.6' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
  '.cm-diagnostic': { fontFamily: 'var(--font-ui)', padding: '6px 10px' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warn)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-panels': { background: 'var(--bg)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 213, 0, 0.35)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 170, 0, 0.55)' },
});

const light = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: '#1d1d1f' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#2f6fde', textDecoration: 'underline' },
  { tag: t.monospace, color: '#6b6b6f' },
  { tag: t.comment, color: '#9a9aa0', fontStyle: 'italic' },
  { tag: [t.keyword, t.bool, t.null, t.atom], color: '#c2185b' },
  { tag: t.string, color: '#1f8a3b' },
  { tag: t.number, color: '#b0620f' },
  { tag: t.function(t.variableName), color: '#2f6fde' },
  { tag: [t.propertyName, typstTags.interpolated], color: '#8b41b1' },
  { tag: [t.escape, t.labelName], color: '#1d7480' },
  { tag: typstTags.listMarker, color: '#2f6fde', fontWeight: '700' },
  { tag: typstTags.mathDelimiter, color: '#1f8a3b' },
  { tag: [t.punctuation, t.operator, t.paren], color: '#86868b' },
  { tag: t.invalid, color: '#d93b30' },
]);

const dark = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: '#f2f2f4' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#6ea8ff', textDecoration: 'underline' },
  { tag: t.monospace, color: '#b3b3b8' },
  { tag: t.comment, color: '#6a6a70', fontStyle: 'italic' },
  { tag: [t.keyword, t.bool, t.null, t.atom], color: '#ff7ab2' },
  { tag: t.string, color: '#7fd49b' },
  { tag: t.number, color: '#f2b36b' },
  { tag: t.function(t.variableName), color: '#6ea8ff' },
  { tag: [t.propertyName, typstTags.interpolated], color: '#c89bf0' },
  { tag: [t.escape, t.labelName], color: '#5fc7d1' },
  { tag: typstTags.listMarker, color: '#6ea8ff', fontWeight: '700' },
  { tag: typstTags.mathDelimiter, color: '#7fd49b' },
  { tag: [t.punctuation, t.operator, t.paren], color: '#7c7c82' },
  { tag: t.invalid, color: '#ff7a70' },
]);

export function editorTheme(isDark: boolean): Extension {
  return [viewTheme, syntaxHighlighting(isDark ? dark : light), EditorView.darkTheme.of(isDark)];
}
