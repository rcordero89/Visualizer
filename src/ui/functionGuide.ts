import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { SerializedValue, TraceResult } from '../types/trace';

export interface FunctionGuideInfo {
  name: string;
  signature: string;
  source: string;
  doc: string;
  plainEnglish?: string;
  loopExamples?: Array<{ code: string; note: string }>;
  params?: Array<{ name: string; detail: string }>;
  returnInfo?: string;
}

const PYTHON_KEYWORDS: Record<string, { sig: string; doc: string; simple: string }> = {
  for: {
    sig: 'for item in iterable:',
    doc: 'Loops over each element in a list, dict, string, or range().\nExample:\n  for row in reader:\n      database.append(row)',
    simple: 'Go through a group of items one by one, and run the indented code for each item.',
  },
  in: {
    sig: 'x in collection  /  for x in collection:',
    doc: '1) Membership test: returns True if x is in a list/dict/str.\n2) Used with "for" to iterate over each item in a sequence.',
    simple: 'Either asks "is this thing inside that group?" or tells a for-loop "pull items from here."',
  },
  with: {
    sig: 'with expr as var:',
    doc: 'Context manager: automatically opens and safely closes a resource (like a file) when the indented block finishes.\nExample:\n  with open("file.csv") as f:\n      data = f.read()',
    simple: 'Open something (like a file), use it inside the indented block, and automatically close it when done.',
  },
  as: {
    sig: 'with expr as var  /  import mod as alias',
    doc: 'Gives a temporary variable name (alias) to an opened resource or imported module.',
    simple: 'Give something a short nickname so you can refer to it easily.',
  },
  if: {
    sig: 'if condition:',
    doc: 'Runs the indented block only when condition evaluates to True.',
    simple: 'Only do this next part if the test is true.',
  },
  elif: {
    sig: 'elif condition:',
    doc: 'Short for "else if" — checked only if the previous if/elif conditions were False.',
    simple: 'If the first test failed, try this backup test instead.',
  },
  else: {
    sig: 'else:',
    doc: 'Fallback block that runs when all preceding if/elif conditions are False.',
    simple: 'If none of the tests above were true, do this instead.',
  },
  while: {
    sig: 'while condition:',
    doc: 'Repeats the indented block as long as condition stays True. Use break to exit early.',
    simple: 'Keep repeating this block over and over until the condition becomes false.',
  },
  def: {
    sig: 'def func_name(param1, param2):',
    doc: 'Defines a reusable function. Use return to send a value back to the caller.',
    simple: 'Create a reusable recipe with a name and ingredients (parameters) that you can call later.',
  },
  return: {
    sig: 'return value',
    doc: 'Exits the current function immediately and sends value back to wherever it was called.',
    simple: 'Hand back the final answer from this function and stop running it.',
  },
  import: {
    sig: 'import module  /  import module as alias',
    doc: 'Loads another Python module (like csv, sys, math) so you can use its functions.',
    simple: 'Bring in a toolbox of extra commands written by someone else.',
  },
  from: {
    sig: 'from module import name',
    doc: 'Imports specific functions or classes directly from a module.',
    simple: 'Grab just one or two specific tools out of a toolbox.',
  },
  break: {
    sig: 'break',
    doc: 'Immediately exits the innermost for or while loop.',
    simple: 'Emergency stop: jump out of the loop right now.',
  },
  continue: {
    sig: 'continue',
    doc: 'Skips the rest of the current loop pass and jumps to the next iteration.',
    simple: 'Skip the rest of this turn and move on to the next item in the loop.',
  },
  try: {
    sig: 'try: ... except ErrorType:',
    doc: 'Runs code that might raise an error so you can handle it in an except block without crashing.',
    simple: 'Try running this risky code; if it breaks, jump to "except" instead of crashing.',
  },
  except: {
    sig: 'except SomeError as e:',
    doc: 'Catches and handles an error raised inside the matching try block.',
    simple: 'The safety net: what to do if the code inside "try" ran into an error.',
  },
  and: {
    sig: 'cond1 and cond2',
    doc: 'Logical AND: True only if both cond1 and cond2 are True.',
    simple: 'True only when BOTH sides are true.',
  },
  or: {
    sig: 'cond1 or cond2',
    doc: 'Logical OR: True if at least one of cond1 or cond2 is True.',
    simple: 'True as long as AT LEAST ONE side is true.',
  },
  not: {
    sig: 'not cond',
    doc: 'Logical NOT: flips True to False and False to True.',
    simple: 'Flips true to false, and false to true (the opposite).',
  },
  is: {
    sig: 'a is b  /  x is None',
    doc: 'Checks if two variables point to the exact same object in memory (commonly used for "x is None").',
    simple: 'Checks if two names point to the exact same thing (most often used to check "is None").',
  },
  pass: {
    sig: 'pass',
    doc: 'Placeholder statement that does nothing (used when syntax requires an indented block).',
    simple: 'A blank placeholder that does nothing—just keeps Python happy until you write code there.',
  },
  lambda: {
    sig: 'lambda args: expression',
    doc: 'Creates a small, single-expression anonymous function.',
    simple: 'A tiny one-line throwaway function with no name.',
  },
  class: {
    sig: 'class ClassName:',
    doc: 'Defines a blueprint for creating custom objects with attributes and methods.',
    simple: 'A blueprint for building your own custom data type that holds both data and actions.',
  },
};

const PLAIN_ENGLISH_FUNCS: Record<string, string> = {
  print: 'Displays text or values on your screen so you can see them.',
  len: 'Counts how many items are in a list, dictionary, or characters in a string.',
  sum: 'Adds up all the numbers in a list or sequence.',
  max: 'Finds the biggest item in a group of numbers or values.',
  min: 'Finds the smallest item in a group of numbers or values.',
  round: 'Rounds a decimal number to the nearest whole number (or a set number of decimal places).',
  range: 'Generates a sequence of numbers (like 0, 1, 2, 3, 4) for a loop.',
  open: 'Opens a file on your computer so you can read from it or write to it.',
  sorted: 'Returns a new list with the items arranged in order (smallest to largest).',
  enumerate: 'Gives you both the position number (0, 1, 2...) AND the item while looping.',
  int: 'Turns text or a decimal into a whole number (integer).',
  float: 'Turns text or a whole number into a decimal number.',
  str: 'Turns a number or other value into text (a string).',
  list: 'Creates a numbered list (or converts something into a list).',
  dict: 'Creates a key-value dictionary.',
  printf: 'Prints formatted text to the screen using placeholders like %d (number) and %s (text).',
  scanf: 'Waits for the user to type something and stores it into a variable.',
  push_back: 'Sticks a new item onto the very end of a vector.',
  size: 'Tells you how many items are currently inside the container.',
  sort: 'Puts all items in order from smallest to largest.',
};

const CPP_STDLIB_DOCS: Record<string, { sig: string; doc: string }> = {
  printf: {
    sig: 'int printf(const char* format, ...)',
    doc: 'Prints formatted text to stdout. Use %d (int), %f (double), %s (char*), %c (char).',
  },
  scanf: {
    sig: 'int scanf(const char* format, ...)',
    doc: 'Reads formatted input from stdin into variable addresses (pass &var for primitives).',
  },
  push_back: {
    sig: 'void push_back(const T& value)',
    doc: 'Appends an element to the end of a std::vector or std::string.',
  },
  pop_back: {
    sig: 'void pop_back()',
    doc: 'Removes the last element from a std::vector or std::string.',
  },
  emplace_back: {
    sig: 'reference emplace_back(Args&&... args)',
    doc: 'Constructs a new element in-place at the end of a std::vector.',
  },
  insert: {
    sig: 'iterator insert(pos, value)',
    doc: 'Inserts element(s) into a std::vector, std::set, or std::map.',
  },
  erase: {
    sig: 'iterator erase(pos_or_key)',
    doc: 'Removes element(s) by iterator position or key from a container.',
  },
  size: {
    sig: 'size_t size() const',
    doc: 'Returns the number of elements currently in the container.',
  },
  empty: {
    sig: 'bool empty() const',
    doc: 'Returns true if the container has 0 elements, false otherwise.',
  },
  find: {
    sig: 'iterator find(const Key& key)',
    doc: 'Searches a std::map or std::set for key; returns end() if not found.',
  },
  sort: {
    sig: 'void std::sort(RandomIt first, RandomIt last)',
    doc: 'Sorts elements in [first, last) in ascending order (from <algorithm>).',
  },
};

export interface CursorTarget {
  kind: 'function' | 'symbol' | 'bracket';
  name: string;
}

/**
 * Finds the function call/definition, variable identifier, or enclosing bracket (`[`/`{`)
 * at or around the cursor.
 */
export function detectTargetAtCursor(
  doc: vscode.TextDocument,
  pos: vscode.Position
): CursorTarget | undefined {
  const lineText = doc.lineAt(pos.line).text;

  // 1. Identifier directly under cursor
  const wordRange = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_.]*/);
  if (wordRange) {
    const word = doc.getText(wordRange);
    const after = lineText.slice(wordRange.end.character).trimStart();
    const beforeWord = lineText.slice(0, wordRange.start.character).trimEnd();
    if (after.startsWith('(') || /\bdef$/.test(beforeWord)) {
      return { kind: 'function', name: word };
    }
    return { kind: 'symbol', name: word };
  }

  // 2. Scan backwards on current line for unclosed `(`, `[`, or `{`
  const before = lineText.slice(0, pos.character);
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ')') parenDepth++;
    else if (ch === '(') {
      if (parenDepth === 0) {
        const prefix = before.slice(0, i).trimEnd();
        const m = prefix.match(/([A-Za-z_][A-Za-z0-9_.]*)$/);
        if (m) return { kind: 'function', name: m[1] };
      } else {
        parenDepth--;
      }
    } else if (ch === ']') bracketDepth++;
    else if (ch === '[') {
      if (bracketDepth === 0) return { kind: 'bracket', name: 'list' };
      bracketDepth--;
    } else if (ch === '}') braceDepth++;
    else if (ch === '{') {
      if (braceDepth === 0) return { kind: 'bracket', name: 'dict' };
      braceDepth--;
    }
  }

  return undefined;
}

function buildContainerGuide(name: string, val: SerializedValue): FunctionGuideInfo | undefined {
  if (val.kind === 'list' || val.kind === 'tuple') {
    const len = val.length ?? val.entries?.length ?? 0;
    const sampleRef =
      val.entries && val.entries.length > 0
        ? `${name}${val.entries[0].accessExpr}${
            val.entries[0].value.entries?.[0]?.accessExpr ?? ''
          }`
        : `${name}[0]`;
    const firstVal = val.entries?.[0]?.value;
    const firstPreview = firstVal ? firstVal.preview : '...';
    const subKey =
      firstVal?.kind === 'dict' && firstVal.entries?.[0]
        ? ` (e.g. item${firstVal.entries[0].accessExpr})`
        : '';

    return {
      name,
      signature: `${name}: ${val.typeName}(${len})`,
      source: val.kind === 'list' ? 'List (Ordered Sequence)' : 'Tuple (Immutable Sequence)',
      plainEnglish:
        val.kind === 'list'
          ? `A numbered row of ${len} box(es) starting at 0. Grab items by slot number like ${name}[0].`
          : `A locked row of ${len} box(es) starting at 0—like a list, except you can't change what's inside.`,
      loopExamples: [
        {
          code: `for item in ${name}:`,
          note: `item = ${firstPreview}${subKey}`,
        },
        {
          code: `for i in range(len(${name})):`,
          note: `i = 0..${Math.max(0, len - 1)}, ${name}[i] = ${firstPreview}`,
        },
      ],
      doc:
        `Access items by 0-based index: ${sampleRef}\n` +
        (val.kind === 'list'
          ? `Common methods: ${name}.append(x), ${name}.pop(), len(${name})`
          : `Tuples cannot be modified after creation. Use len(${name}) for length.`),
      params: val.entries?.slice(0, 4).map((e) => ({
        name: `${name}${e.accessExpr}`,
        detail: `${e.value.typeName} = ${e.value.preview}`,
      })),
    };
  }

  if (val.kind === 'dict') {
    const len = val.length ?? val.entries?.length ?? 0;
    const keys = val.entries?.slice(0, 5).map((e) => e.key) ?? [];
    const sampleRef =
      val.entries && val.entries.length > 0
        ? `${name}${val.entries[0].accessExpr}${
            val.entries[0].value.entries?.[0]?.accessExpr ?? ''
          }`
        : `${name}["key"]`;
    const firstEntry = val.entries?.[0];
    const firstKey = firstEntry ? JSON.stringify(firstEntry.key) : '"key"';
    const firstValPrev = firstEntry ? firstEntry.value.preview : '...';

    return {
      name,
      signature: `${name}: ${val.typeName}(${len})`,
      source: 'Dictionary (Key-Value Map)',
      plainEnglish: `A labeled filing cabinet with ${len} drawer(s). Instead of numbers, every value has a name tag (key) like ${name}["${keys[0] ?? 'key'}"].`,
      loopExamples: [
        {
          code: `for key in ${name}:`,
          note: `key = ${firstKey}, ${name}[key] = ${firstValPrev}`,
        },
        {
          code: `for key, val in ${name}.items():`,
          note: `key = ${firstKey}, val = ${firstValPrev}`,
        },
      ],
      doc:
        `Access values by key: ${sampleRef}\n` +
        (keys.length > 0 ? `Keys: ${keys.join(', ')}\n` : '') +
        `Common methods: ${name}.get(key), ${name}.keys(), ${name}.items()`,
      params: val.entries?.slice(0, 4).map((e) => ({
        name: `${name}${e.accessExpr}`,
        detail: `${e.value.typeName} = ${e.value.preview}`,
      })),
    };
  }

  if (val.kind === 'object') {
    const attrs = val.entries ?? [];
    return {
      name,
      signature: `${name}: ${val.typeName}`,
      source: 'Object Attributes (.)',
      plainEnglish: `A custom bundle holding named pieces of data. Use a dot (.) to grab a piece, like ${name}.${attrs[0]?.key ?? 'attribute'}.`,
      doc:
        attrs.length > 0
          ? `Available attributes: ${attrs.map((a) => `${name}.${a.key}`).join(', ')}`
          : `Instance of ${val.typeName}.`,
      params: attrs.slice(0, 6).map((e) => ({
        name: `${name}${e.accessExpr}`,
        detail: `${e.value.typeName} = ${e.value.preview}`,
      })),
    };
  }

  return undefined;
}

export class FunctionGuideService {
  private readonly pyDocCache = new Map<string, FunctionGuideInfo | null>();

  constructor(private readonly extensionPath: string) {}

  async lookup(
    target: CursorTarget,
    doc: vscode.TextDocument,
    trace: TraceResult | undefined,
    pythonPath: string
  ): Promise<FunctionGuideInfo | undefined> {
    const bareName = target.name.includes('.') ? target.name.split('.').pop()! : target.name;

    // 1. Bracket cheat-sheet (`list` or `dict`)
    if (target.kind === 'bracket') {
      if (target.name === 'list') {
        return {
          name: 'list',
          signature: 'list: [item0, item1, ...]',
          source: 'Data Structure Guide',
          doc: 'Ordered, mutable collection indexed by 0, 1, 2...\nAccess: my_list[0] | Add: my_list.append(x) | Length: len(my_list)',
        };
      }
      return {
        name: 'dict',
        signature: 'dict: {"key": value, ...}',
        source: 'Data Structure Guide',
        doc: 'Key-value mapping. Keys must be unique & immutable (e.g. str, int).\nAccess: my_dict["key"] | Safe access: my_dict.get("key") | Set: my_dict["key"] = val',
      };
    }

    // 2. If it's a symbol that matches a list/dict variable in the trace, show its Data Structure Guide!
    if (target.kind === 'symbol' && trace) {
      for (const call of [...trace.calls].reverse()) {
        const val = call.locals[bareName] ?? call.args[bareName];
        if (val) {
          const guide = buildContainerGuide(bareName, val);
          if (guide) return guide;
        }
      }
    }

    // 3. Check user-defined function in trace
    const matchingCalls = trace?.calls.filter((c) => c.name === bareName) ?? [];
    if (matchingCalls.length > 0) {
      const latest = matchingCalls[matchingCalls.length - 1];
      const params = Object.entries(latest.args).map(([k, v]) => ({
        name: k,
        detail: `${v.typeName}${v.length !== undefined ? `(${v.length})` : ''} — e.g. ${v.preview}`,
      }));
      const paramStr = params.map((p) => p.name).join(', ');
      return {
        name: bareName,
        signature: `${bareName}(${paramStr})`,
        source: 'Your Function',
        doc: `Called ${matchingCalls.length} time${matchingCalls.length === 1 ? '' : 's'} in this run.`,
        params,
        returnInfo: latest.returnValue
          ? `${latest.returnValue.typeName} — e.g. ${latest.returnValue.preview}`
          : undefined,
      };
    }

    // 4. Check static definition in file
    const staticDef = this.findStaticDef(doc, bareName);
    if (staticDef) {
      return {
        name: bareName,
        signature: `${bareName}(${staticDef.params.join(', ')})`,
        source: `Your Function (line ${staticDef.line})`,
        doc: staticDef.doc || 'Defined in this file (not called yet).',
        params: staticDef.params.map((p) => ({ name: p, detail: 'parameter' })),
      };
    }

    // 5. Python keyword & library/builtin lookup (handles for, with, as, in, round, sum, etc.)
    if (doc.languageId === 'python') {
      const kw = PYTHON_KEYWORDS[target.name];
      if (kw) {
        return {
          name: target.name,
          signature: kw.sig,
          source: 'Python Keyword',
          plainEnglish: kw.simple,
          doc: kw.doc,
        };
      }
      const cacheKey = `${target.name}`;
      if (this.pyDocCache.has(cacheKey)) {
        return this.pyDocCache.get(cacheKey) ?? undefined;
      }
      const res = await this.queryPythonDoc(target.name, doc.getText(), pythonPath);
      if (res && PLAIN_ENGLISH_FUNCS[bareName]) {
        res.plainEnglish = PLAIN_ENGLISH_FUNCS[bareName];
      }
      this.pyDocCache.set(cacheKey, res ?? null);
      return res;
    }

    // 6. C/C++ stdlib lookup
    const cppDoc = CPP_STDLIB_DOCS[bareName];
    if (cppDoc) {
      return {
        name: bareName,
        signature: cppDoc.sig,
        source: 'C/C++ Standard Library',
        plainEnglish: PLAIN_ENGLISH_FUNCS[bareName],
        doc: cppDoc.doc,
      };
    }

    return undefined;
  }

  async evalSelection(
    expr: string,
    doc: vscode.TextDocument,
    line: number,
    workingDir: string,
    args: string[],
    pythonPath: string
  ): Promise<FunctionGuideInfo | undefined> {
    if (doc.languageId !== 'python') return undefined;
    const scriptPath = path.join(this.extensionPath, 'tracers', 'python_eval.py');
    const fileName = doc.isUntitled ? 'untitled.py' : doc.fileName;

    return new Promise((resolve) => {
      const child = spawn(pythonPath || 'python', [scriptPath], {
        cwd: workingDir || undefined,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(undefined);
      }, 1500);

      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(out) as {
            ok: boolean;
            value?: SerializedValue;
            error?: string;
          };
          if (!parsed.ok || !parsed.value) {
            if (parsed.error) {
              resolve({
                name: expr,
                signature: expr,
                source: 'Selection Error',
                doc: parsed.error,
              });
            } else {
              resolve(undefined);
            }
            return;
          }
          const v = parsed.value;
          const lenNote = v.length !== undefined ? `(${v.length})` : '';
          resolve({
            name: expr,
            signature: expr,
            source: `Selection: ${v.typeName}${lenNote}`,
            plainEnglish:
              v.typeName === 'range'
                ? `A number sequence that produces ${v.preview.split('->')[1]?.trim() || v.preview}.`
                : v.length !== undefined
                  ? `Evaluates to a ${v.typeName} with ${v.length} item(s): ${v.preview}`
                  : `Evaluates to ${v.preview} (${v.typeName}).`,
            doc: `Value: ${v.preview}`,
            params: v.entries?.slice(0, 6).map((e) => ({
              name: e.accessExpr,
              detail: `${e.value.typeName} = ${e.value.preview}`,
            })),
          });
        } catch {
          resolve(undefined);
        }
      });

      child.stdin.write(
        JSON.stringify({
          code: doc.getText(),
          fileName,
          line,
          expr,
          args,
        })
      );
      child.stdin.end();
    });
  }

  private findStaticDef(
    doc: vscode.TextDocument,
    fnName: string
  ): { params: string[]; line: number; doc?: string } | undefined {
    const pyRe = new RegExp(`^\\s*def\\s+${fnName}\\s*\\(([^)]*)\\)`);
    const cRe = new RegExp(
      `^\\s*(?:[A-Za-z_][A-Za-z0-9_:<>*&\\s]+?)\\s+${fnName}\\s*\\(([^)]*)\\)\\s*(?:const\\s*)?\\{?\\s*$`
    );
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (doc.languageId === 'python') {
        const m = text.match(pyRe);
        if (m) {
          const params = m[1]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
          return { params, line: i + 1 };
        }
      } else {
        const m = text.match(cRe);
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

  private queryPythonDoc(
    symbol: string,
    code: string,
    pythonPath: string
  ): Promise<FunctionGuideInfo | undefined> {
    const scriptPath = path.join(this.extensionPath, 'tracers', 'python_doc.py');
    return new Promise((resolve) => {
      const child = spawn(pythonPath || 'python', [scriptPath], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(undefined);
      }, 1500);

      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(out) as {
            found: boolean;
            name?: string;
            signature?: string;
            doc?: string;
          };
          if (!parsed.found) {
            resolve(undefined);
            return;
          }
          resolve({
            name: parsed.name || symbol,
            signature: parsed.signature || symbol,
            source: 'Python Standard Library',
            doc: parsed.doc || '',
          });
        } catch {
          resolve(undefined);
        }
      });

      child.stdin.write(JSON.stringify({ symbol, code }));
      child.stdin.end();
    });
  }
}
