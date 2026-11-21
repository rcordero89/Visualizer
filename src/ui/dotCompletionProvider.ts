import * as vscode from 'vscode';
import { SerializedValue, TraceResult } from '../types/trace';

interface MethodSpec {
  name: string;
  insertText: string;
  detail: string;
  doc: string;
}

const PYTHON_METHODS: Record<string, MethodSpec[]> = {
  list: [
    { name: 'append', insertText: 'append($1)', detail: 'list.append(object)', doc: 'Append object to the end of the list.' },
    { name: 'extend', insertText: 'extend($1)', detail: 'list.extend(iterable)', doc: 'Extend list by appending elements from the iterable.' },
    { name: 'insert', insertText: 'insert($1, $2)', detail: 'list.insert(index, object)', doc: 'Insert object before index.' },
    { name: 'pop', insertText: 'pop($1)', detail: 'list.pop(index=-1)', doc: 'Remove and return item at index (default last).' },
    { name: 'remove', insertText: 'remove($1)', detail: 'list.remove(value)', doc: 'Remove first occurrence of value.' },
    { name: 'index', insertText: 'index($1)', detail: 'list.index(value)', doc: 'Return first index of value.' },
    { name: 'count', insertText: 'count($1)', detail: 'list.count(value)', doc: 'Return number of occurrences of value.' },
    { name: 'sort', insertText: 'sort($1)', detail: 'list.sort(key=None, reverse=False)', doc: 'Sort the list in ascending order in-place.' },
    { name: 'reverse', insertText: 'reverse()', detail: 'list.reverse()', doc: 'Reverse the elements of the list in-place.' },
    { name: 'copy', insertText: 'copy()', detail: 'list.copy()', doc: 'Return a shallow copy of the list.' },
    { name: 'clear', insertText: 'clear()', detail: 'list.clear()', doc: 'Remove all items from list.' },
  ],
  dict: [
    { name: 'get', insertText: 'get($1)', detail: 'dict.get(key, default=None)', doc: 'Return the value for key if key is in the dictionary, else default.' },
    { name: 'keys', insertText: 'keys()', detail: 'dict.keys()', doc: 'Return a view object of all keys in the dictionary.' },
    { name: 'values', insertText: 'values()', detail: 'dict.values()', doc: 'Return a view object of all values in the dictionary.' },
    { name: 'items', insertText: 'items()', detail: 'dict.items()', doc: 'Return a view object of (key, value) pairs.' },
    { name: 'pop', insertText: 'pop($1)', detail: 'dict.pop(key)', doc: 'Remove specified key and return the corresponding value.' },
    { name: 'update', insertText: 'update($1)', detail: 'dict.update(other)', doc: 'Update the dictionary with key/value pairs from other.' },
    { name: 'setdefault', insertText: 'setdefault($1, $2)', detail: 'dict.setdefault(key, default=None)', doc: 'Insert key with a value of default if key is not in the dict.' },
    { name: 'copy', insertText: 'copy()', detail: 'dict.copy()', doc: 'Return a shallow copy of the dictionary.' },
    { name: 'clear', insertText: 'clear()', detail: 'dict.clear()', doc: 'Remove all items from the dictionary.' },
  ],
  str: [
    { name: 'split', insertText: 'split($1)', detail: 'str.split(sep=None)', doc: 'Return a list of the substrings in the string, using sep as delimiter.' },
    { name: 'strip', insertText: 'strip($1)', detail: 'str.strip(chars=None)', doc: 'Return a copy of the string with leading and trailing whitespace removed.' },
    { name: 'join', insertText: 'join($1)', detail: 'str.join(iterable)', doc: 'Concatenate any number of strings.' },
    { name: 'replace', insertText: 'replace($1, $2)', detail: 'str.replace(old, new)', doc: 'Return a copy with all occurrences of substring old replaced by new.' },
    { name: 'find', insertText: 'find($1)', detail: 'str.find(sub)', doc: 'Return the lowest index where substring sub is found (-1 if not found).' },
    { name: 'count', insertText: 'count($1)', detail: 'str.count(sub)', doc: 'Return the number of non-overlapping occurrences of substring sub.' },
    { name: 'lower', insertText: 'lower()', detail: 'str.lower()', doc: 'Return a copy of the string converted to lowercase.' },
    { name: 'upper', insertText: 'upper()', detail: 'str.upper()', doc: 'Return a copy of the string converted to uppercase.' },
    { name: 'startswith', insertText: 'startswith($1)', detail: 'str.startswith(prefix)', doc: 'Return True if string starts with the specified prefix.' },
    { name: 'endswith', insertText: 'endswith($1)', detail: 'str.endswith(suffix)', doc: 'Return True if string ends with the specified suffix.' },
    { name: 'isdigit', insertText: 'isdigit()', detail: 'str.isdigit()', doc: 'Return True if the string is a digit string.' },
  ],
  set: [
    { name: 'add', insertText: 'add($1)', detail: 'set.add(elem)', doc: 'Add an element to a set.' },
    { name: 'remove', insertText: 'remove($1)', detail: 'set.remove(elem)', doc: 'Remove an element from a set (raises KeyError if missing).' },
    { name: 'discard', insertText: 'discard($1)', detail: 'set.discard(elem)', doc: 'Remove an element from a set if it is a member.' },
    { name: 'pop', insertText: 'pop()', detail: 'set.pop()', doc: 'Remove and return an arbitrary set element.' },
    { name: 'clear', insertText: 'clear()', detail: 'set.clear()', doc: 'Remove all elements from this set.' },
  ],
  tuple: [
    { name: 'count', insertText: 'count($1)', detail: 'tuple.count(value)', doc: 'Return number of occurrences of value.' },
    { name: 'index', insertText: 'index($1)', detail: 'tuple.index(value)', doc: 'Return first index of value.' },
  ],
};

function findVarValue(trace: TraceResult, varName: string): SerializedValue | undefined {
  for (const call of [...trace.calls].reverse()) {
    if (call.locals[varName]) return call.locals[varName];
    if (call.args[varName]) return call.args[varName];
  }
  return undefined;
}

export class DotCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getTrace: (doc: vscode.TextDocument) => TraceResult | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const trace = this.getTrace(document);
    if (!trace) return undefined;

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const match = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z0-9_]*$/);
    if (!match) return undefined;

    const varName = match[1];
    const val = findVarValue(trace, varName);
    if (!val) return undefined;

    const items: vscode.CompletionItem[] = [];

    // 1. Object attributes captured at runtime (e.g., reader.fieldnames, reader.line_num)
    if (val.kind === 'object' && val.entries) {
      val.entries.forEach((entry, idx) => {
        const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Field);
        item.detail = `${val.typeName}.${entry.key}: ${entry.value.typeName}`;
        item.documentation = new vscode.MarkdownString(`Current value: \`${entry.value.preview}\``);
        item.sortText = `0_${String(idx).padStart(3, '0')}`;
        items.push(item);
      });
    }

    // 2. True methods for the variable's runtime type (list, dict, str, set, tuple)
    const typeKey =
      val.kind === 'list' || val.kind === 'dict' || val.kind === 'set' || val.kind === 'tuple'
        ? val.kind
        : val.typeName === 'str'
          ? 'str'
          : undefined;

    if (typeKey && PYTHON_METHODS[typeKey]) {
      PYTHON_METHODS[typeKey].forEach((m, idx) => {
        const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
        item.insertText = new vscode.SnippetString(m.insertText);
        item.detail = `[ScopeViz: ${varName} is ${val.typeName}] ${m.detail}`;
        item.documentation = new vscode.MarkdownString(m.doc);
        item.sortText = `0_${String(idx).padStart(3, '0')}`;
        items.push(item);
      });
    }

    return items.length > 0 ? items : undefined;
  }
}
