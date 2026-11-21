export interface InstrumentResult {
  code: string;
}

const CONTROL_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'catch',
  'do',
  'struct',
  'class',
  'enum',
  'union',
  'namespace',
  'typedef',
]);

function stripCommentsAndStrings(line: string, inBlockComment: boolean): {
  cleaned: string;
  inBlockComment: boolean;
} {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  let block = inBlockComment;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (block) {
      if (ch === '*' && next === '/') {
        block = false;
        out += '  ';
        i += 2;
      } else {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (inStr) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === inStr) {
        inStr = null;
      }
      out += ' ';
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      block = true;
      out += '  ';
      i += 2;
      continue;
    }

    if (ch === '/' && next === '/') {
      break;
    }

    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ' ';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return { cleaned: out, inBlockComment: block };
}

function parseParamNames(paramList: string): string[] {
  const trimmed = paramList.trim();
  if (!trimmed || trimmed === 'void') return [];

  // Split by commas outside angle brackets / parens
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of trimmed) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);

  const names: string[] = [];
  for (const p of parts) {
    // Remove default value `= ...`
    const noDefault = p.split('=')[0].trim();
    // Remove array brackets `[]`
    const noArr = noDefault.replace(/\[[^\]]*\]/g, '').trim();
    const match = noArr.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (match && !CONTROL_KEYWORDS.has(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

export function instrumentCCpp(source: string, isCpp: boolean): InstrumentResult {
  const lines = source.split(/\r?\n/);
  const outLines: string[] = [];
  let braceDepth = 0;
  let inBlockComment = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const raw = lines[idx];
    const { cleaned, inBlockComment: nextBlock } = stripCommentsAndStrings(raw, inBlockComment);
    inBlockComment = nextBlock;

    const trimmed = cleaned.trim();
    let instrumented = raw;

    // Count braces on this line
    let openBraces = 0;
    let closeBraces = 0;
    for (const ch of cleaned) {
      if (ch === '{') openBraces++;
      else if (ch === '}') closeBraces++;
    }

    // Detect function definition at top level (braceDepth === 0)
    if (
      braceDepth === 0 &&
      !trimmed.startsWith('#') &&
      openBraces === 1 &&
      closeBraces === 0 &&
      trimmed.includes('(') &&
      trimmed.includes(')') &&
      !trimmed.endsWith(';')
    ) {
      const fnMatch = trimmed.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:const\s*)?\{$/);
      if (fnMatch && !CONTROL_KEYWORDS.has(fnMatch[1])) {
        const fnName = fnMatch[1];
        const params = parseParamNames(fnMatch[2]);
        const injectCall = isCpp
          ? ` __VIZ_FN(${lineNum}, "${fnName}");`
          : ` __VIZ_CALL(${lineNum}, "${fnName}");`;
        const injectParams = params
          .map((p) => ` __VIZ_VAR(${lineNum}, "${p}", ${p});`)
          .join('');
        const bracePos = raw.lastIndexOf('{');
        if (bracePos !== -1) {
          instrumented =
            raw.slice(0, bracePos + 1) + injectCall + injectParams + raw.slice(bracePos + 1);
        }
      }
    } else if (braceDepth >= 1 && !trimmed.startsWith('#') && trimmed.endsWith(';')) {
      // Single-line statement inside a function
      const isControl = /^(if|else|for|while|switch|do)\b/.test(trimmed);

      if (!isControl) {
        // 1. Return statement (non-void)
        const retMatch = trimmed.match(/^return\s+(.+);$/);
        if (retMatch) {
          const retIdx = raw.indexOf('return');
          const semiIdx = raw.lastIndexOf(';');
          const expr = raw.slice(retIdx + 6, semiIdx).trim();
          if (expr && !expr.startsWith('__VIZ_RET')) {
            instrumented =
              raw.slice(0, retIdx) +
              `return __VIZ_RET(${lineNum}, (${expr}));` +
              raw.slice(semiIdx + 1);
          }
        } else if (/^printf\s*\(/.test(trimmed)) {
          instrumented = raw.replace(/\bprintf\s*\(/, `__VIZ_PRINTF(${lineNum}, `);
        } else {
          // 2. Variable declaration or assignment or mutating container method
          let varToLog: string | null = null;

          // Mutating STL / container method call: vec.push_back(...); or mp.insert(...);
          const methodMatch = trimmed.match(
            /^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(push_back|pop_back|emplace_back|insert|erase|clear|push|pop|resize|assign)\s*\(/
          );
          if (methodMatch) {
            varToLog = methodMatch[1];
          } else if (trimmed.includes('=')) {
            // Assignment or declaration with `=` (avoid `==`, `!=`, `<=`, `>=`)
            const eqMatch = trimmed.match(/^([^=!<>\n]+?)\s*(?:\+|-|\*|\/|%|&|\||\^)?=(?!=)/);
            if (eqMatch) {
              const lhs = eqMatch[1].trim();
              // Handle `mp["key"] = val` or `arr[i] = val`
              const subscriptMatch = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\[/);
              if (subscriptMatch) {
                varToLog = subscriptMatch[1];
              } else {
                // Handle declaration `std::vector<int> v` or `int arr[5]` or `x`
                const noArr = lhs.replace(/\[[^\]]*\]/g, '').trim();
                const nameMatch = noArr.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
                if (nameMatch && !CONTROL_KEYWORDS.has(nameMatch[1])) {
                  varToLog = nameMatch[1];
                }
              }
            }
          } else {
            // Uninitialized or constructor-initialized declaration: `vector<int> v(5, 0);` or `int x;`
            const ctorMatch = trimmed.match(
              /^(?:const\s+|static\s+|unsigned\s+|signed\s+|long\s+|short\s+)*(?:[A-Za-z_][A-Za-z0-9_:<> ,*&\s]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*;$/
            );
            if (ctorMatch && !CONTROL_KEYWORDS.has(ctorMatch[1])) {
              varToLog = ctorMatch[1];
            }
          }

          if (varToLog) {
            const semiIdx = raw.lastIndexOf(';');
            instrumented =
              raw.slice(0, semiIdx + 1) +
              ` __VIZ_VAR(${lineNum}, "${varToLog}", ${varToLog});` +
              raw.slice(semiIdx + 1);
          }
        }
      }
    }

    braceDepth = Math.max(0, braceDepth + openBraces - closeBraces);
    outLines.push(instrumented);
  }

  const header = `#include "viz_trace.h"\n#line 1 "user_code"\n`;
  return { code: header + outLines.join('\n') };
}
