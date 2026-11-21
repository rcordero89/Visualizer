import * as vscode from 'vscode';
import { SerializedValue, TraceResult } from '../types/trace';

function findVarValue(trace: TraceResult, varName: string): SerializedValue | undefined {
  for (const call of [...trace.calls].reverse()) {
    if (call.locals[varName]) return call.locals[varName];
    if (call.args[varName]) return call.args[varName];
  }
  return undefined;
}

/**
 * Resolves a chained expression like `database[0]` or `summary["Alice"]`
 * against the latest valid trace.
 */
function resolveChainedValue(trace: TraceResult, expr: string): SerializedValue | undefined {
  const headMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!headMatch) return undefined;

  let cur = findVarValue(trace, headMatch[1]);
  let rest = headMatch[2];

  while (cur && rest.length > 0) {
    const idxMatch = rest.match(/^\[([^\]]+)\](.*)$/);
    const attrMatch = rest.match(/^\.([A-Za-z_][A-Za-z0-9_]*)(.*)$/);

    if (idxMatch) {
      const rawKey = idxMatch[1].trim().replace(/^["']|["']$/g, '');
      const entry = cur.entries?.find((e) => e.key === rawKey);
      if (!entry) return undefined;
      cur = entry.value;
      rest = idxMatch[2];
    } else if (attrMatch) {
      const attr = attrMatch[1];
      const entry = cur.entries?.find((e) => e.key === attr);
      if (!entry) return undefined;
      cur = entry.value;
      rest = attrMatch[2];
    } else {
      return undefined;
    }
  }

  return cur;
}

export class BracketCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getTrace: (doc: vscode.TextDocument) => TraceResult | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const trace = this.getTrace(document);
    if (!trace) return undefined;

    const fullLine = document.lineAt(position.line).text;
    const linePrefix = fullLine.slice(0, position.character);
    const lineSuffix = fullLine.slice(position.character);

    // Match `var[` or `var[0][` or `obj.attr[` with optional partial key/quote
    const match = linePrefix.match(
      /([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\]|\.[A-Za-z_][A-Za-z0-9_]*)*)\[\s*(["']?)[A-Za-z0-9_]*$/
    );
    if (!match) return undefined;

    const targetExpr = match[1];
    const openQuote = match[2];
    const val = resolveChainedValue(trace, targetExpr);
    if (!val || !val.entries || val.entries.length === 0) return undefined;

    const hasClosingBracket = lineSuffix.startsWith(']');
    const hasClosingQuote = openQuote && lineSuffix.startsWith(openQuote);
    const items: vscode.CompletionItem[] = [];

    if (val.kind === 'dict') {
      val.entries.forEach((entry, idx) => {
        const isIntKey = entry.keyType === 'int';
        const label = isIntKey ? entry.key : `"${entry.key}"`;
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);

        if (openQuote) {
          item.insertText =
            entry.key + (hasClosingQuote ? '' : openQuote) + (hasClosingBracket ? '' : ']');
        } else {
          item.insertText = label + (hasClosingBracket ? '' : ']');
        }

        item.detail = `[ScopeViz: ${targetExpr}] ${entry.value.typeName} = ${entry.value.preview}`;
        item.documentation = new vscode.MarkdownString(
          `Reference: \`${targetExpr}${entry.accessExpr}\`\n\nValue: \`${entry.value.preview}\``
        );
        item.sortText = `0_${String(idx).padStart(3, '0')}`;
        items.push(item);
      });
    } else if (val.kind === 'list' || val.kind === 'tuple') {
      val.entries.forEach((entry, idx) => {
        const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Value);
        item.insertText = entry.key + (hasClosingBracket ? '' : ']');
        item.detail = `[ScopeViz: ${targetExpr}[${entry.key}]] ${entry.value.typeName} = ${entry.value.preview}`;
        item.documentation = new vscode.MarkdownString(
          `Reference: \`${targetExpr}[${entry.key}]\`\n\nValue: \`${entry.value.preview}\``
        );
        item.sortText = `0_${String(idx).padStart(3, '0')}`;
        items.push(item);
      });
    }

    return items.length > 0 ? items : undefined;
  }
}
