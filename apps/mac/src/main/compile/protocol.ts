// Messages between the main process (CompileHost) and the compiler utility process (engine.ts).

export interface EngineDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** Absolute path as reported by Typst (empty for virtual/package files). */
  path: string;
  package: string;
  range: { startLine: number; startCol: number; endLine: number; endCol: number } | null;
}

export interface CompileOutputs {
  svg?: boolean;
  pdf?: boolean;
  /** Query the app's introspection metadata (<__layout>, <__sketch>, <__blocks>). */
  query?: boolean;
}

export type EngineRequest =
  | { id: number; type: 'init'; root: string }
  | {
      id: number;
      type: 'compile';
      /** Absolute path of the note (must be inside the root). */
      path: string;
      /** Unsaved editor text; overrides the file on disk until `unmap`. */
      source?: string;
      inputs: Record<string, string>;
      outputs: CompileOutputs;
    }
  | { id: number; type: 'unmap'; path: string };

export interface EngineCompileResult {
  ok: boolean;
  pageCount: number;
  diagnostics: EngineDiagnostic[];
  svg?: string;
  pdf?: Uint8Array;
  /** Raw metadata values: <__layout> (first), <__sketch> (all), <__blocks> (one array per page). */
  layout?: unknown;
  sketches?: unknown[];
  blocks?: unknown[][];
  /** Exact page sizes from <__page> (notes using lib.typ only). */
  pages?: unknown[];
  ms: number;
}

export type EngineResponse =
  | { id: number; ok: true; result?: EngineCompileResult }
  | { id: number; ok: false; error: string };
