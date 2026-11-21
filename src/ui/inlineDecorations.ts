import * as vscode from 'vscode';
import { SerializedValue, TraceResult } from '../types/trace';

function formatHoverValue(name: string, val: SerializedValue, alias?: string): string {
  const aliasNote = alias ? ` *(from \`${alias}\`)*` : '';
  if (!val.entries || val.entries.length === 0) {
    return `- \`${name}\`${aliasNote} *(${val.typeName})*: \`${val.preview}\``;
  }
  const sample = val.entries[0];
  const sampleRef = `${name}${sample.accessExpr}`;
  return `- \`${name}\`${aliasNote} *(${val.typeName}, ${val.length ?? val.entries.length} items)*: \`${val.preview}\`  \n  *Example ref:* \`${sampleRef}\``;
}

export class InlineDecorationManager {
  private readonly valueDecorationType: vscode.TextEditorDecorationType;
  private readonly errorDecorationType: vscode.TextEditorDecorationType;

  constructor() {
    this.valueDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1.5em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
      },
      isWholeLine: true,
    });

    this.errorDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1.5em',
        color: new vscode.ThemeColor('editorError.foreground'),
        fontStyle: 'italic',
      },
      backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
      isWholeLine: true,
    });
  }

  clear(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    editor.setDecorations(this.valueDecorationType, []);
    editor.setDecorations(this.errorDecorationType, []);
  }

  apply(editor: vscode.TextEditor, trace: TraceResult, enabled: boolean): void {
    if (!enabled) {
      this.clear(editor);
      return;
    }

    const doc = editor.document;
    const valueDecorations: vscode.DecorationOptions[] = [];
    const errorDecorations: vscode.DecorationOptions[] = [];

    for (const [lineKey, snap] of Object.entries(trace.lineSnapshots)) {
      const lineNum = Number(lineKey);
      if (lineNum < 1 || lineNum > doc.lineCount) continue;
      if (!snap.summary) continue;

      const lineObj = doc.lineAt(lineNum - 1);
      const range = new vscode.Range(lineObj.range.end, lineObj.range.end);

      const hoverLines = Object.entries(snap.locals).map(([name, v]) =>
        formatHoverValue(name, v, snap.aliases?.[name])
      );
      if (snap.returnValue) {
        hoverLines.push(`- **return** *(${snap.returnValue.typeName})*: \`${snap.returnValue.preview}\``);
      }

      const countNote = snap.runCount && snap.runCount > 1 ? `, ran ${snap.runCount}x` : '';
      const md = new vscode.MarkdownString(
        `**ScopeViz** (\`${snap.callName}\`, line ${lineNum}${countNote})\n\n${hoverLines.join('\n')}`
      );
      md.isTrusted = true;

      valueDecorations.push({
        range,
        hoverMessage: md,
        renderOptions: {
          after: {
            contentText: `⟶ ${snap.summary}`,
          },
        },
      });
    }

    if (trace.error?.line && trace.error.line >= 1 && trace.error.line <= doc.lineCount) {
      const errLine = doc.lineAt(trace.error.line - 1);
      errorDecorations.push({
        range: new vscode.Range(errLine.range.end, errLine.range.end),
        hoverMessage: new vscode.MarkdownString(`**ScopeViz Error:** ${trace.error.message}`),
        renderOptions: {
          after: {
            contentText: `⚠ ${trace.error.message}`,
          },
        },
      });
    }

    editor.setDecorations(this.valueDecorationType, valueDecorations);
    editor.setDecorations(this.errorDecorationType, errorDecorations);
  }

  dispose(): void {
    this.valueDecorationType.dispose();
    this.errorDecorationType.dispose();
  }
}
