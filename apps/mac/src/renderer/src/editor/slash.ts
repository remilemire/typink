// "/" at the start of a line opens a menu of formatting snippets.

import { type Completion, type CompletionContext, type CompletionResult, snippet } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { editorCallbacks, type SlashAction } from './callbacks';

interface SlashCommand {
  label: string;
  detail: string;
  /** Snippet template (`${}` marks fields) or an app action. */
  run: string | SlashAction | (() => string);
  aliases?: string;
}

const today = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const COMMANDS: SlashCommand[] = [
  { label: 'Heading 1', detail: '=', run: '= ${}', aliases: 'h1 title' },
  { label: 'Heading 2', detail: '==', run: '== ${}', aliases: 'h2' },
  { label: 'Heading 3', detail: '===', run: '=== ${}', aliases: 'h3' },
  { label: 'Bulleted list', detail: '-', run: '- ${}', aliases: 'ul bullet' },
  { label: 'Numbered list', detail: '+', run: '+ ${}', aliases: 'ol enum' },
  { label: 'Task', detail: 'checkbox', run: '#task[${}]', aliases: 'todo check' },
  { label: 'Sketch on iPad', detail: 'draw here', run: 'sketch', aliases: 'draw ink pencil diagram' },
  { label: 'Sketch beside text', detail: 'two columns', run: 'sketch-beside', aliases: 'draw columns' },
  { label: 'Image…', detail: 'from Finder', run: 'image', aliases: 'picture photo figure' },
  { label: 'Draw on image…', detail: 'annotate a picture', run: 'draw-on-image', aliases: 'annotate photo' },
  { label: 'Tip', detail: 'callout', run: '#tip[${}]', aliases: 'callout' },
  { label: 'Info', detail: 'callout', run: '#info[${}]', aliases: 'callout note' },
  { label: 'Warning', detail: 'callout', run: '#warning[${}]', aliases: 'callout caution' },
  { label: 'Important', detail: 'callout', run: '#important[${}]', aliases: 'callout' },
  { label: 'Quote', detail: 'block quote', run: '#quote(block: true)[${}]' },
  { label: 'Math block', detail: '$ … $', run: '$ ${} $', aliases: 'equation formula' },
  { label: 'Code block', detail: '```', run: '```${lang}\n${}\n```', aliases: 'raw' },
  { label: 'Table', detail: '3 columns', run: '#table(\n  columns: 3,\n  [*${Column}*], [*Column*], [*Column*],\n  [${}], [], [],\n)' },
  { label: 'Two columns', detail: 'side by side', run: '#cols[\n  ${}\n][\n  \n]', aliases: 'grid layout' },
  { label: 'Margin note', detail: 'in the margin', run: '#margin-note[${}]', aliases: 'aside' },
  { label: 'Highlight', detail: 'marker', run: '#hl[${}]' },
  { label: 'Footnote', detail: 'numbered', run: '#footnote[${}]' },
  { label: 'Link', detail: 'URL', run: '#link("${https://}")[${text}]' },
  { label: 'Divider', detail: 'horizontal rule', run: '#divider()\n${}', aliases: 'line rule hr' },
  { label: 'Page break', detail: 'new page', run: '#pagebreak()\n${}' },
  { label: 'Date', detail: 'today', run: () => today(), aliases: 'today' },
];

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\/[\w-]*$/);
  if (!word) return null;
  const line = context.state.doc.lineAt(word.from);
  // Only at the start of a line (after indentation), so "a/b" in prose never triggers.
  if (!/^\s*$/.test(line.text.slice(0, word.from - line.from))) return null;

  const options: Completion[] = COMMANDS.map((cmd, i) => ({
    // The label is what gets matched, so aliases let "/todo" find "Task".
    label: `/${cmd.label}${cmd.aliases ? ` ${cmd.aliases}` : ''}`,
    displayLabel: cmd.label,
    detail: cmd.detail,
    type: 'text',
    // Keep the curated order when nothing has been typed after "/".
    boost: 60 - i,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => apply(view, cmd, from, to),
  }));
  return {
    from: word.from,
    options,
    filter: true,
    validFor: /^\/[\w-]*$/,
  };
}

function apply(view: EditorView, cmd: SlashCommand, from: number, to: number): void {
  if (typeof cmd.run === 'function') {
    const text = cmd.run();
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    return;
  }
  if (cmd.run === 'sketch' || cmd.run === 'sketch-beside' || cmd.run === 'image' || cmd.run === 'draw-on-image') {
    view.dispatch({ changes: { from, to, insert: '' } });
    view.state.facet(editorCallbacks).slashAction(cmd.run);
    return;
  }
  snippet(cmd.run)(view, { label: cmd.label }, from, to);
}
