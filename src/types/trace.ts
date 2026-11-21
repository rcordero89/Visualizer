export type ValueKind =
  | 'primitive'
  | 'list'
  | 'dict'
  | 'tuple'
  | 'set'
  | 'object'
  | 'null'
  | 'error';

export interface ValueEntry {
  key: string;
  keyType?: string;
  /** Language-specific expression suffix to reference this child (e.g. `[0]`, `["name"]`, `.age`). */
  accessExpr: string;
  value: SerializedValue;
}

export interface SerializedValue {
  kind: ValueKind;
  typeName: string;
  preview: string;
  length?: number;
  entries?: ValueEntry[];
  truncated?: boolean;
}

export interface LineEvent {
  line: number;
  locals: Record<string, SerializedValue>;
  changed: string[];
  aliases?: Record<string, string>;
}

export interface FunctionCallTrace {
  id: string;
  name: string;
  callLine: number;
  depth: number;
  args: Record<string, SerializedValue>;
  locals: Record<string, SerializedValue>;
  returnValue?: SerializedValue;
  events: LineEvent[];
}

export interface LineSnapshot {
  line: number;
  summary: string;
  locals: Record<string, SerializedValue>;
  changed: string[];
  aliases?: Record<string, string>;
  returnValue?: SerializedValue;
  callName: string;
  runCount?: number;
}

export interface TraceError {
  kind: 'syntax' | 'compile' | 'runtime' | 'timeout';
  message: string;
  line?: number;
}

export type SupportedLanguage = 'python' | 'c' | 'cpp';

export interface TraceResult {
  language: SupportedLanguage;
  fileName: string;
  ok: boolean;
  error?: TraceError;
  stdout: string;
  stderr: string;
  calls: FunctionCallTrace[];
  lineSnapshots: Record<number, LineSnapshot>;
  truncated?: boolean;
  durationMs: number;
}
