import { spawn } from 'child_process';
import * as path from 'path';
import { LanguageTracer, TraceOptions } from './base';
import { TraceResult } from '../types/trace';

export class PythonTracer implements LanguageTracer {
  readonly language = 'python' as const;

  constructor(private readonly extensionPath: string) {}

  async trace(options: TraceOptions): Promise<TraceResult> {
    const start = Date.now();
    const runnerPath = path.join(this.extensionPath, 'tracers', 'python_runner.py');

    return new Promise<TraceResult>((resolve) => {
      const child = spawn(options.executablePath || 'python', [runnerPath], {
        cwd: options.workingDir || undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          language: 'python',
          fileName: options.fileName,
          ok: false,
          error: {
            kind: 'runtime',
            message: `Failed to start Python (${options.executablePath}): ${err.message}`,
          },
          stdout: '',
          stderr: err.message,
          calls: [],
          lineSnapshots: {},
          durationMs: Date.now() - start,
        });
      });

      child.on('close', () => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;

        if (timedOut) {
          resolve({
            language: 'python',
            fileName: options.fileName,
            ok: false,
            error: {
              kind: 'timeout',
              message: `Execution timed out after ${options.timeoutMs}ms (possible infinite loop or blocking input).`,
            },
            stdout: '',
            stderr,
            calls: [],
            lineSnapshots: {},
            durationMs,
          });
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as TraceResult;
          parsed.durationMs = durationMs;
          resolve(parsed);
        } catch {
          resolve({
            language: 'python',
            fileName: options.fileName,
            ok: false,
            error: {
              kind: 'runtime',
              message: stderr.trim() || 'Python tracer produced invalid output.',
            },
            stdout,
            stderr,
            calls: [],
            lineSnapshots: {},
            durationMs,
          });
        }
      });

      child.stdin.write(
        JSON.stringify({
          code: options.code,
          fileName: options.fileName,
          args: options.args ?? [],
        })
      );
      child.stdin.end();
    });
  }
}
