import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageTracer } from './tracers/base';
import { CppTracer } from './tracers/cppTracer';
import { PythonTracer } from './tracers/pythonTracer';
import { SupportedLanguage, TraceResult } from './types/trace';
import { BracketCompletionProvider } from './ui/bracketCompletionProvider';
import { DotCompletionProvider } from './ui/dotCompletionProvider';
import { detectTargetAtCursor, FunctionGuideService } from './ui/functionGuide';
import { InlineDecorationManager } from './ui/inlineDecorations';
import { InspectorPanelProvider } from './ui/inspectorPanel';

function mapLanguage(langId: string): SupportedLanguage | undefined {
  if (langId === 'python') return 'python';
  if (langId === 'c') return 'c';
  if (langId === 'cpp') return 'cpp';
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('scopeviz');
  let isLive = cfg.get<boolean>('enabledByDefault', true);

  const tracers: Record<SupportedLanguage, LanguageTracer> = {
    python: new PythonTracer(context.extensionPath),
    c: new CppTracer('c', context.extensionPath),
    cpp: new CppTracer('cpp', context.extensionPath),
  };

  const decorations = new InlineDecorationManager();
  const guideService = new FunctionGuideService(context.extensionPath);
  let debounceTimer: NodeJS.Timeout | undefined;
  let guideTimer: NodeJS.Timeout | undefined;
  let runSeq = 0;
  const lastTraces = new Map<string, TraceResult>();
  const lastValidTraces = new Map<string, TraceResult>();
  const argsByDoc = new Map<string, string>();

  function parseCliArgs(raw: string): string[] {
    const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
    if (!matches) return [];
    return matches.map((m) => m.replace(/^["']|["']$/g, ''));
  }

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'scopeviz.toggleLive';
  context.subscriptions.push(statusItem);

  const updateStatusBar = (running = false) => {
    if (running) {
      statusItem.text = '$(sync~spin) ScopeViz: Tracing...';
    } else if (isLive) {
      statusItem.text = '$(eye) ScopeViz: Live';
      statusItem.tooltip = 'Click to pause live visualization';
    } else {
      statusItem.text = '$(eye-closed) ScopeViz: Paused';
      statusItem.tooltip = 'Click to resume live visualization';
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && mapLanguage(editor.document.languageId)) {
      statusItem.show();
    } else {
      statusItem.hide();
    }
  };

  const runForEditor = async (editor: vscode.TextEditor | undefined) => {
    if (!editor) return;
    const lang = mapLanguage(editor.document.languageId);
    if (!lang) return;

    const seq = ++runSeq;
    const currentCfg = vscode.workspace.getConfiguration('scopeviz');
    const timeoutMs = currentCfg.get<number>('timeoutMs', 2500);
    const showInline = currentCfg.get<boolean>('showInlineDecorations', true);

    const execPath =
      lang === 'python'
        ? currentCfg.get<string>('pythonPath', 'python')
        : lang === 'c'
          ? currentCfg.get<string>('gccPath', 'gcc')
          : currentCfg.get<string>('gppPath', 'g++');

    const doc = editor.document;
    const fileName = doc.isUntitled ? `untitled.${lang === 'python' ? 'py' : lang}` : doc.fileName;
    const workingDir = doc.isUntitled
      ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
      : path.dirname(doc.fileName);

    updateStatusBar(true);

    const rawArgs = argsByDoc.get(doc.uri.toString()) ?? '';
    const result = await tracers[lang].trace({
      code: doc.getText(),
      fileName,
      workingDir,
      timeoutMs,
      executablePath: execPath,
      args: parseCliArgs(rawArgs),
    });

    if (seq !== runSeq) return; // superseded by newer edit

    const docKey = doc.uri.toString();
    if (result.calls.length > 0) {
      lastValidTraces.set(docKey, result);
    } else if (result.error) {
      const prevValid = lastValidTraces.get(docKey);
      if (prevValid) {
        result.calls = prevValid.calls;
        result.lineSnapshots = prevValid.lineSnapshots;
        if (!result.stdout) result.stdout = prevValid.stdout;
      }
    }
    lastTraces.set(docKey, result);
    if (vscode.window.activeTextEditor?.document.uri.toString() === docKey) {
      decorations.apply(editor, result, showInline);
      panelProvider.update(result, isLive, rawArgs);
    }
    updateStatusBar(false);
  };

  const scheduleRun = (editor: vscode.TextEditor | undefined) => {
    if (!isLive || !editor) return;
    if (!mapLanguage(editor.document.languageId)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    const delay = vscode.workspace.getConfiguration('scopeviz').get<number>('debounceMs', 650);
    debounceTimer = setTimeout(() => {
      void runForEditor(editor);
    }, delay);
  };

  const panelProvider = new InspectorPanelProvider({
    onRunNow: () => {
      void runForEditor(vscode.window.activeTextEditor);
    },
    onToggleLive: () => {
      void vscode.commands.executeCommand('scopeviz.toggleLive');
    },
    onJumpToLine: (line: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const targetLine = Math.max(0, Math.min(line - 1, editor.document.lineCount - 1));
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    },
    onArgsChanged: (argsText: string) => {
      const active = vscode.window.activeTextEditor;
      if (!active) return;
      const key = active.document.uri.toString();
      if ((argsByDoc.get(key) ?? '') === argsText) return;
      argsByDoc.set(key, argsText);
      void runForEditor(active);
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(InspectorPanelProvider.viewType, panelProvider),
    vscode.languages.registerCompletionItemProvider(
      'python',
      new DotCompletionProvider((doc) => lastValidTraces.get(doc.uri.toString())),
      '.'
    ),
    vscode.languages.registerCompletionItemProvider(
      'python',
      new BracketCompletionProvider((doc) => lastValidTraces.get(doc.uri.toString())),
      '[',
      '"',
      "'"
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('scopeviz.toggleLive', () => {
      isLive = !isLive;
      updateStatusBar();
      panelProvider.setLiveState(isLive);
      if (isLive) {
        void runForEditor(vscode.window.activeTextEditor);
      }
    }),
    vscode.commands.registerCommand('scopeviz.runNow', () => {
      void runForEditor(vscode.window.activeTextEditor);
    }),
    vscode.commands.registerCommand('scopeviz.openInspector', () => {
      void vscode.commands.executeCommand('scopeviz.inspector.focus');
    }),
    vscode.commands.registerCommand('scopeviz.clear', () => {
      decorations.clear(vscode.window.activeTextEditor);
      panelProvider.update(undefined, isLive);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar();
      if (!editor) {
        panelProvider.update(undefined, isLive);
        return;
      }
      const key = editor.document.uri.toString();
      const cached = lastTraces.get(key);
      const rawArgs = argsByDoc.get(key) ?? '';
      if (cached) {
        const showInline = vscode.workspace
          .getConfiguration('scopeviz')
          .get<boolean>('showInlineDecorations', true);
        decorations.apply(editor, cached, showInline);
        panelProvider.update(cached, isLive, rawArgs);
      } else if (isLive && mapLanguage(editor.document.languageId)) {
        panelProvider.update(undefined, isLive, rawArgs);
        void runForEditor(editor);
      } else {
        panelProvider.update(undefined, isLive, rawArgs);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const active = vscode.window.activeTextEditor;
      if (active && e.document.uri.toString() === active.document.uri.toString()) {
        scheduleRun(active);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const active = vscode.window.activeTextEditor;
      if (isLive && active && doc.uri.toString() === active.document.uri.toString()) {
        if (debounceTimer) clearTimeout(debounceTimer);
        void runForEditor(active);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!mapLanguage(e.textEditor.document.languageId)) return;
      const sel = e.selections[0];
      if (!sel) return;

      // Update Function / Data Structure Guide or evaluate highlighted expression
      if (guideTimer) clearTimeout(guideTimer);
      guideTimer = setTimeout(async () => {
        const doc = e.textEditor.document;
        const pythonPath = vscode.workspace
          .getConfiguration('scopeviz')
          .get<string>('pythonPath', 'python');

        if (!sel.isEmpty && sel.isSingleLine && doc.languageId === 'python') {
          const expr = doc.getText(sel).trim();
          if (expr.length >= 2 && /[.\[(+\-*/%]/.test(expr)) {
            const workingDir = doc.isUntitled
              ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
              : path.dirname(doc.fileName);
            const rawArgs = argsByDoc.get(doc.uri.toString()) ?? '';
            const evalInfo = await guideService.evalSelection(
              expr,
              doc,
              sel.start.line + 1,
              workingDir,
              parseCliArgs(rawArgs),
              pythonPath
            );
            if (evalInfo) {
              panelProvider.setFunctionGuide(evalInfo);
              return;
            }
          }
        }

        const target = detectTargetAtCursor(doc, sel.active);
        if (!target) {
          panelProvider.setFunctionGuide(undefined);
          return;
        }
        const info = await guideService.lookup(
          target,
          doc,
          lastValidTraces.get(doc.uri.toString()),
          pythonPath
        );
        panelProvider.setFunctionGuide(info);
      }, 220);

      if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
      if (sel.isEmpty || !sel.isSingleLine) return;

      const selectedText = e.textEditor.document.getText(sel);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(selectedText)) return;

      const trace = lastTraces.get(e.textEditor.document.uri.toString());
      if (!trace || !trace.calls.length) return;

      const existsInTrace = trace.calls.some(
        (c) =>
          Object.prototype.hasOwnProperty.call(c.args, selectedText) ||
          Object.prototype.hasOwnProperty.call(c.locals, selectedText) ||
          c.events.some((ev) => Object.prototype.hasOwnProperty.call(ev.locals, selectedText))
      );
      if (!existsInTrace) return;

      const usedLines: number[] = [];
      const doc = e.textEditor.document;
      const wordRe = new RegExp(`\\b${selectedText}\\b`);
      for (let i = 0; i < doc.lineCount; i++) {
        if (wordRe.test(doc.lineAt(i).text)) {
          usedLines.push(i + 1);
        }
      }

      void panelProvider.focusVariable(selectedText, sel.start.line + 1, usedLines);
    })
  );

  context.subscriptions.push(decorations);

  updateStatusBar();
  if (isLive && vscode.window.activeTextEditor) {
    void runForEditor(vscode.window.activeTextEditor);
  }
}

export function deactivate(): void {}
