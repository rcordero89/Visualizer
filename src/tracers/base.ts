import { SupportedLanguage, TraceResult } from '../types/trace';

export interface TraceOptions {
  code: string;
  fileName: string;
  workingDir: string;
  timeoutMs: number;
  executablePath: string;
  args?: string[];
}

export interface LanguageTracer {
  readonly language: SupportedLanguage;
  trace(options: TraceOptions): Promise<TraceResult>;
}
