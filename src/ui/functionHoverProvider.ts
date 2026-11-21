import * as vscode from 'vscode';
import { SerializedValue, TraceResult, ValueEntry } from '../types/trace';

function describeShape(val: SerializedValue): string {
  if (val.kind === 'list' && val.entries && val.entries.length > 0) {
    const first = val.entries[0].value;
    if (first.kind === 'dict' && first.entries && first.entries.length > 0) {
      const keys = first.entries.slice(0, 4).map((e) => `\`${e.key}\``).join(', ');
      return `\`${val.typeName}(${val.length ?? val.entries.length})\` of \`dict\` with keys: ${keys}`;
    }
    return `\`${val.typeName}(${val.length ?? val.entries.length})\` of \`${first.typeName}\``;
  }
  if (val.kind === 'dict' && val.entries && val.entries.length > 0) {
    const keys = val.entries.slice(0, 4).map((e) => `\`${e.key}\``).join(', ');
    return `\`${val.typeName}(${val.length ?? val.entries.length})\` (keys: ${keys})`;
  }
  return `\`${val.typeName}\``;
}

function buildSampleAccess(root: string, val: SerializedValue, maxDepth = 2): string {
  let expr = root;
  let cur: SerializedValue | undefined = val;
  for (let i = 0; i < maxDepth; i++) {
    if (!cur?.entries || cur.entries.length === 0) break;
    const first: ValueEntry = cur.entries[0];
    expr += first.accessExpr;
    cur = first.value;
  }
  return expr;
}

function findStaticSignature(
  doc: vscode.TextDocument,
  fnName: string
): { params: string[]; returnHint?: string; line: number } | undefined {
  const pyRe = new RegExp(`^\\s*def\\s+${fnName}\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^:]+))?\\s*:`);
  const cRe = new RegExp(
    `^\\s*(?:[A-Za-z_][A-Za-z0-9_:<>*&\\s]+?)\\s+${fnName}\\s*\\(([^)]*)\\)\\s*(?:const\\s*)?\\{?\\s*$`
  );

  for (let i = 0; i < doc.lineCount; i++) {
    const lineText = doc.lineAt(i).text;
    if (doc.languageId === 'python') {
      const m = lineText.match(pyRe);
      if (m) {
        const params = m[1]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        return { params, returnHint: m[2]?.trim(), line: i + 1 };
      }
    } else {
      const m = lineText.match(cRe);
      if (m) {
        const params = m[1]
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p && p !== 'void');
        return { params, line: i + 1 };
      }
    }
  }
  return undefined;
}

export class FunctionHoverProvider implements vscode.HoverProvider {
  constructor(private readonly getTrace: (doc: vscode.TextDocument) => TraceResult | undefined) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) return undefined;

    const word = document.getText(range);
    const trace = this.getTrace(document);
    const matchingCalls = trace?.calls.filter((c) => c.name === word) ?? [];
    const staticSig = findStaticSignature(document, word);

    if (matchingCalls.length === 0 && !staticSig) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (matchingCalls.length > 0) {
      const latest = matchingCalls[matchingCalls.length - 1];
      const argEntries = Object.entries(latest.args);
      const paramList =
        argEntries.length > 0
          ? argEntries.map(([k]) => k).join(', ')
          : staticSig?.params.join(', ') ?? '';

      md.appendMarkdown(`### \`${word}(${paramList})\`\n`);
      md.appendMarkdown(
        `*Called ${matchingCalls.length} time${matchingCalls.length === 1 ? '' : 's'} in this run*\n\n`
      );

      if (argEntries.length > 0) {
        md.appendMarkdown(`**What goes in (Arguments):**\n`);
        for (const [k, v] of argEntries) {
          md.appendMarkdown(`- \`${k}\`: ${describeShape(v)} — e.g. \`${v.preview}\`\n`);
        }
        md.appendMarkdown(`\n`);
      } else {
        md.appendMarkdown(`**Parameters:** *(none)*\n\n`);
      }

      if (latest.returnValue) {
        md.appendMarkdown(
          `**What comes out (Return):** ${describeShape(latest.returnValue)} — e.g. \`${latest.returnValue.preview}\`\n\n`
        );
        if (latest.returnValue.entries && latest.returnValue.entries.length > 0) {
          const sampleAccess = buildSampleAccess('result', latest.returnValue);
          md.appendMarkdown(`**Example usage:**\n`);
          md.appendCodeblock(
            `result = ${word}(${paramList})\n# Access inside result: ${sampleAccess}`,
            document.languageId
          );
        } else {
          md.appendMarkdown(`**Example usage:**\n`);
          md.appendCodeblock(`${word}(${paramList})`, document.languageId);
        }
      } else {
        md.appendMarkdown(`**Example usage:**\n`);
        md.appendCodeblock(`${word}(${paramList})`, document.languageId);
      }

      return new vscode.Hover(md, range);
    }

    if (staticSig) {
      const paramStr = staticSig.params.join(', ');
      md.appendMarkdown(`### \`${word}(${paramStr})\`\n`);
      md.appendMarkdown(`*Defined on line ${staticSig.line} (not called yet)*\n\n`);
      if (staticSig.params.length > 0) {
        md.appendMarkdown(`**Parameters:**\n`);
        for (const p of staticSig.params) {
          md.appendMarkdown(`- \`${p}\`\n`);
        }
        md.appendMarkdown(`\n`);
      }
      if (staticSig.returnHint) {
        md.appendMarkdown(`**Expected return:** \`${staticSig.returnHint}\`\n\n`);
      }
      md.appendMarkdown(`**How to call it:**\n`);
      md.appendCodeblock(`${word}(${paramStr})`, document.languageId);
      md.appendMarkdown(`\n*Tip: Call \`${word}(...)\` in your code to see live argument & return examples.*`);
      return new vscode.Hover(md, range);
    }

    return undefined;
  }
}
