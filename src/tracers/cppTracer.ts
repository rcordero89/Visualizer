import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LanguageTracer, TraceOptions } from './base';
import { instrumentCCpp } from './cInstrumenter';
import {
  FunctionCallTrace,
  LineSnapshot,
  SerializedValue,
  TraceResult,
} from '../types/trace';

interface RawEvent {
  ev: 'call' | 'exit' | 'var' | 'ret' | 'print';
  line: number;
  name?: string;
  value?: SerializedValue;
  text?: string;
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnErr?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut: false, spawnErr: err.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function parseCompilerErrorLine(stderr: string): { message: string; line?: number } {
  const lines = stderr.split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(/(?:user_code|[^:]+):(\d+):(?:\d+:)?\s*(?:fatal )?error:\s*(.+)/);
    if (m) {
      return { line: parseInt(m[1], 10), message: m[2].trim() };
    }
  }
  return { message: stderr.trim() || 'Compilation failed.' };
}

export class CppTracer implements LanguageTracer {
  constructor(
    public readonly language: 'c' | 'cpp',
    private readonly extensionPath: string
  ) {}

  async trace(options: TraceOptions): Promise<TraceResult> {
    const start = Date.now();
    const isCpp = this.language === 'cpp';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scopeviz-'));
    const ext = isCpp ? '.cpp' : '.c';
    const srcFile = path.join(tmpDir, `prog${ext}`);
    const exeFile = path.join(tmpDir, process.platform === 'win32' ? 'prog.exe' : 'prog');
    const includeDir = path.join(this.extensionPath, 'tracers');

    try {
      const { code: instrumentedCode } = instrumentCCpp(options.code, isCpp);
      fs.writeFileSync(srcFile, instrumentedCode, 'utf8');

      const compiler = options.executablePath || (isCpp ? 'g++' : 'gcc');
      const stdFlag = isCpp ? '-std=c++17' : '-std=c11';
      const compileRes = await runProcess(
        compiler,
        [stdFlag, '-O0', '-I', includeDir, srcFile, '-o', exeFile],
        options.workingDir || tmpDir,
        Math.max(options.timeoutMs, 8000)
      );

      if (compileRes.spawnErr) {
        return {
          language: this.language,
          fileName: options.fileName,
          ok: false,
          error: {
            kind: 'compile',
            message: `Failed to run ${compiler}: ${compileRes.spawnErr}`,
          },
          stdout: '',
          stderr: compileRes.spawnErr,
          calls: [],
          lineSnapshots: {},
          durationMs: Date.now() - start,
        };
      }

      if (compileRes.code !== 0) {
        const errInfo = parseCompilerErrorLine(compileRes.stderr);
        return {
          language: this.language,
          fileName: options.fileName,
          ok: false,
          error: {
            kind: 'compile',
            message: errInfo.message,
            line: errInfo.line,
          },
          stdout: compileRes.stdout,
          stderr: compileRes.stderr,
          calls: [],
          lineSnapshots: {},
          durationMs: Date.now() - start,
        };
      }

      const runRes = await runProcess(
        exeFile,
        options.args ?? [],
        options.workingDir || tmpDir,
        options.timeoutMs
      );

      if (runRes.timedOut) {
        return {
          language: this.language,
          fileName: options.fileName,
          ok: false,
          error: {
            kind: 'timeout',
            message: `Execution timed out after ${options.timeoutMs}ms (possible infinite loop or blocking input).`,
          },
          stdout: runRes.stdout,
          stderr: '',
          calls: [],
          lineSnapshots: {},
          durationMs: Date.now() - start,
        };
      }

      const calls: FunctionCallTrace[] = [];
      const stack: FunctionCallTrace[] = [];
      const lineSnapshots: Record<number, LineSnapshot> = {};
      const cleanStderrLines: string[] = [];
      let callSeq = 0;

      for (const rawLine of runRes.stderr.split(/\r?\n/)) {
        if (!rawLine.startsWith('__SCOPEVIZ_JSON__:')) {
          if (rawLine.length > 0) cleanStderrLines.push(rawLine);
          continue;
        }
        const jsonPart = rawLine.slice('__SCOPEVIZ_JSON__:'.length);
        let ev: RawEvent;
        try {
          ev = JSON.parse(jsonPart) as RawEvent;
        } catch {
          continue;
        }

        if (ev.ev === 'call') {
          callSeq++;
          const callRec: FunctionCallTrace = {
            id: `call_${callSeq}`,
            name: ev.name || 'fn',
            callLine: ev.line,
            depth: stack.length,
            args: {},
            locals: {},
            events: [],
          };
          calls.push(callRec);
          stack.push(callRec);
        } else if (ev.ev === 'exit') {
          stack.pop();
        } else if (ev.ev === 'var' && ev.name && ev.value) {
          const top = stack[stack.length - 1];
          if (top) {
            if (ev.line === top.callLine) {
              top.args[ev.name] = ev.value;
            }
            top.locals[ev.name] = ev.value;
            const localsCopy = { ...top.locals };
            top.events.push({
              line: ev.line,
              locals: localsCopy,
              changed: [ev.name],
            });
            const prevSnap = lineSnapshots[ev.line];
            const part = `${ev.name} = ${ev.value.preview}`;
            const combinedSummary =
              prevSnap && ev.line === top.callLine && !prevSnap.changed.includes(ev.name)
                ? `${prevSnap.summary} | ${part}`
                : part;
            const combinedChanged =
              prevSnap && ev.line === top.callLine && !prevSnap.changed.includes(ev.name)
                ? [...prevSnap.changed, ev.name]
                : [ev.name];
            lineSnapshots[ev.line] = {
              line: ev.line,
              summary: combinedSummary,
              locals: localsCopy,
              changed: combinedChanged,
              callName: top.name,
            };
          }
        } else if (ev.ev === 'print' && ev.text !== undefined) {
          const top = stack[stack.length - 1];
          if (top) {
            const localsCopy = { ...top.locals };
            lineSnapshots[ev.line] = {
              line: ev.line,
              summary: `print: ${ev.text}`,
              locals: localsCopy,
              changed: [],
              callName: top.name,
            };
          }
        } else if (ev.ev === 'ret' && ev.value) {
          const top = stack[stack.length - 1];
          if (top) {
            top.returnValue = ev.value;
            const localsCopy = { ...top.locals };
            lineSnapshots[ev.line] = {
              line: ev.line,
              summary: `return ${ev.value.preview}`,
              locals: localsCopy,
              changed: [],
              returnValue: ev.value,
              callName: top.name,
            };
          }
        }
      }

      return {
        language: this.language,
        fileName: options.fileName,
        ok: runRes.code === 0,
        error:
          runRes.code !== 0
            ? {
                kind: 'runtime',
                message: cleanStderrLines.join('\n') || `Exited with code ${runRes.code}`,
              }
            : undefined,
        stdout: runRes.stdout,
        stderr: cleanStderrLines.join('\n'),
        calls,
        lineSnapshots,
        durationMs: Date.now() - start,
      };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
