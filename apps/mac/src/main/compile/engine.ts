// The Typst compiler, running in its own Electron utility process.
//
// typst.ts' NodeCompiler is synchronous, so compiling in the main process would
// freeze the UI and the iPad connection. Here a slow compile only delays the
// preview, and CompileHost can kill and restart the process if one hangs.

import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';
import type { EngineCompileResult, EngineDiagnostic, EngineRequest, EngineResponse } from './protocol';

let compiler: NodeCompiler | null = null;
let compileCount = 0;

interface RawDiagnostic {
  message: string;
  package: string;
  path: string;
  severity: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } } | null;
}

function convertDiagnostics(raw: RawDiagnostic[] | undefined | null): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  for (const d of raw ?? []) {
    // Severity 4 entries are call traces ("while calling ..."); fold them into the error above.
    if (d.severity === 4) {
      const last = out[out.length - 1];
      if (last && !last.message.includes(d.message)) last.message += `\n  ${d.message}`;
      continue;
    }
    out.push({
      severity: d.severity === 1 ? 'error' : 'warning',
      message: d.message,
      path: d.path ?? '',
      package: d.package ?? '',
      range: d.range
        ? {
            startLine: d.range.start.line,
            startCol: d.range.start.character,
            endLine: d.range.end.line,
            endCol: d.range.end.character,
          }
        : null,
    });
  }
  return out;
}

function values(c: NodeCompiler, doc: Parameters<NodeCompiler['query']>[0], selector: string): unknown[] {
  return (c.query(doc, { selector }) as { value: unknown }[]).map((m) => m.value);
}

function compile(req: Extract<EngineRequest, { type: 'compile' }>): EngineCompileResult {
  if (!compiler) throw new Error('compiler not initialised');
  const c = compiler;
  if (req.source !== undefined) c.addSource(req.path, req.source);

  const started = performance.now();
  const result = c.compile({ mainFilePath: req.path, inputs: req.inputs });
  if (result.hasError()) {
    const diagnostics = convertDiagnostics(c.fetchDiagnostics(result.takeDiagnostics()!) as RawDiagnostic[]);
    return { ok: false, pageCount: 0, diagnostics, ms: performance.now() - started };
  }

  const doc = result.result!;
  const warnings = result.takeWarnings();
  const diagnostics = warnings ? convertDiagnostics(c.fetchDiagnostics(warnings) as RawDiagnostic[]) : [];
  const out: EngineCompileResult = { ok: true, pageCount: doc.numOfPages, diagnostics, ms: 0 };
  if (req.outputs.svg) out.svg = c.svg(doc);
  if (req.outputs.pdf) out.pdf = new Uint8Array(c.pdf(doc, { pdfTags: false }));
  if (req.outputs.query) {
    out.layout = values(c, doc, '<__layout>')[0] ?? null;
    out.sketches = values(c, doc, '<__sketch>');
    out.blocks = values(c, doc, '<__blocks>') as unknown[][];
    out.pages = values(c, doc, '<__page>');
  }
  out.ms = performance.now() - started;

  if (++compileCount % 40 === 0) c.evictCache(30);
  return out;
}

function handle(req: EngineRequest): EngineResponse {
  switch (req.type) {
    case 'init':
      compiler = NodeCompiler.create({ workspace: req.root });
      return { id: req.id, ok: true };
    case 'compile':
      return { id: req.id, ok: true, result: compile(req) };
    case 'unmap':
      compiler?.unmapShadow(req.path);
      return { id: req.id, ok: true };
  }
}

process.parentPort.on('message', (event) => {
  const req = event.data as EngineRequest;
  let response: EngineResponse;
  try {
    response = handle(req);
  } catch (err) {
    response = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage(response);
});
