import * as vscode from 'vscode';
import { TraceResult } from '../types/trace';
import { FunctionGuideInfo } from './functionGuide';

export interface PanelCallbacks {
  onRunNow: () => void;
  onToggleLive: () => void;
  onJumpToLine: (line: number) => void;
  onArgsChanged: (argsText: string) => void;
}

export class InspectorPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scopeviz.inspector';

  private view?: vscode.WebviewView;
  private latestTrace?: TraceResult;
  private latestGuide?: FunctionGuideInfo;
  private isLive = true;
  private argsText = '';
  private pendingFocus?: { name: string; line: number; usedLines: number[] };

  constructor(private readonly callbacks: PanelCallbacks) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'runNow') {
        this.callbacks.onRunNow();
      } else if (msg.type === 'toggleLive') {
        this.callbacks.onToggleLive();
      } else if (msg.type === 'jumpToLine' && typeof msg.line === 'number') {
        this.callbacks.onJumpToLine(msg.line);
      } else if (msg.type === 'copyRef' && typeof msg.ref === 'string') {
        vscode.env.clipboard.writeText(msg.ref);
        vscode.window.setStatusBarMessage(`Copied reference: ${msg.ref}`, 2500);
      } else if (msg.type === 'setArgs' && typeof msg.argsText === 'string') {
        this.argsText = msg.argsText;
        this.callbacks.onArgsChanged(msg.argsText);
      } else if (msg.type === 'ready') {
        this.postState();
        if (this.pendingFocus) {
          this.view?.webview.postMessage({
            type: 'focusVar',
            name: this.pendingFocus.name,
            line: this.pendingFocus.line,
            usedLines: this.pendingFocus.usedLines,
          });
          this.pendingFocus = undefined;
        }
      }
    });
  }

  update(trace: TraceResult | undefined, isLive: boolean, argsText = this.argsText): void {
    this.latestTrace = trace;
    this.isLive = isLive;
    this.argsText = argsText;
    this.postState();
  }

  setLiveState(isLive: boolean): void {
    this.isLive = isLive;
    this.postState();
  }

  setFunctionGuide(guide: FunctionGuideInfo | undefined): void {
    this.latestGuide = guide;
    if (!this.view) return;
    this.view.webview.postMessage({
      type: 'guide',
      guide: guide ?? null,
    });
  }

  async focusVariable(name: string, line: number, usedLines: number[] = []): Promise<void> {
    this.pendingFocus = { name, line, usedLines };
    if (!this.view) {
      await vscode.commands.executeCommand('scopeviz.inspector.focus');
    } else {
      this.view.show(true);
    }
    if (this.view) {
      this.view.webview.postMessage({ type: 'focusVar', name, line, usedLines });
      this.pendingFocus = undefined;
    }
  }

  private postState(): void {
    if (!this.view) return;
    this.view.webview.postMessage({
      type: 'state',
      trace: this.latestTrace ?? null,
      guide: this.latestGuide ?? null,
      isLive: this.isLive,
      argsText: this.argsText,
    });
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border, rgba(128,128,128,0.25));
    --card: var(--vscode-editor-background);
    --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --err-bg: var(--vscode-inputValidation-errorBackground, rgba(255,80,80,0.15));
    --err-border: var(--vscode-inputValidation-errorBorder, #f14c4c);
    --hover: var(--vscode-list-hoverBackground);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 8px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--fg);
    background: var(--bg);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  button {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: 3px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  button.secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  button:hover { opacity: 0.9; }
  .pill {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: var(--badge-bg);
    color: var(--badge-fg);
  }
  .pill.live { background: #1e7e34; color: #fff; }
  .pill.paused { background: #6c757d; color: #fff; }
  .ref-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    margin-bottom: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }
  .ref-bar code {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-textLink-foreground);
  }
  .error-box {
    background: var(--err-bg);
    border: 1px solid var(--err-border);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 8px;
    font-size: 11px;
  }
  .error-line {
    text-decoration: underline;
    cursor: pointer;
    font-weight: 600;
  }
  .section {
    margin-bottom: 10px;
  }
  .section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  select {
    width: 100%;
    padding: 4px 6px;
    background: var(--vscode-dropdown-background, var(--card));
    color: var(--vscode-dropdown-foreground, var(--fg));
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 12px;
  }
  .tree-node {
    border-left: 1px solid var(--border);
    margin-left: 6px;
    padding-left: 6px;
  }
  .tree-row {
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11.5px;
  }
  .tree-row:hover { background: var(--hover); }
  .tree-row.flash {
    background: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.28));
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
  }
  .toggle {
    width: 12px;
    display: inline-block;
    color: var(--muted);
    user-select: none;
  }
  .var-name { font-weight: 600; color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
  .type-tag {
    font-size: 10px;
    color: var(--muted);
    background: rgba(128,128,128,0.15);
    padding: 0 4px;
    border-radius: 3px;
  }
  .alias-tag {
    font-size: 10px;
    color: var(--vscode-textLink-foreground, #4fc1ff);
    background: rgba(79, 193, 255, 0.12);
    border: 1px solid rgba(79, 193, 255, 0.3);
    padding: 0 4px;
    border-radius: 3px;
    white-space: nowrap;
  }
  .step-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    margin-bottom: 10px;
  }
  .step-bar input[type="range"] {
    flex: 1;
    min-width: 60px;
  }
  .step-label {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .used-bar {
    display: none;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-bottom: 8px;
    font-size: 11px;
  }
  .line-chip {
    background: var(--badge-bg);
    color: var(--badge-fg);
    border: none;
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 10.5px;
    cursor: pointer;
  }
  .guide-card {
    display: none;
    background: var(--card);
    border: 1px solid var(--border);
    border-left: 3px solid var(--vscode-textLink-foreground, #4fc1ff);
    border-radius: 4px;
    padding: 7px 8px;
    margin-bottom: 8px;
    font-size: 11.5px;
  }
  .guide-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
  }
  .guide-sig {
    font-family: var(--vscode-editor-font-family, monospace);
    font-weight: 600;
    color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
    word-break: break-word;
  }
  .guide-doc {
    margin: 4px 0 0 0;
    color: var(--muted);
    white-space: pre-wrap;
    line-height: 1.4;
    font-size: 11px;
  }
  .guide-params {
    margin-top: 5px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    font-size: 11px;
  }
  .guide-simple {
    margin: 5px 0;
    padding: 5px 7px;
    border-radius: 3px;
    background: rgba(79, 193, 255, 0.1);
    color: var(--fg);
    font-size: 11.5px;
    line-height: 1.4;
  }
  .preview {
    color: var(--vscode-debugTokenExpression-string, #ce9178);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .table-wrap {
    overflow-x: auto;
    margin: 4px 0 6px 14px;
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 3px 6px;
    text-align: left;
    white-space: nowrap;
  }
  th { background: rgba(128,128,128,0.12); font-weight: 600; }
  td.clickable { cursor: pointer; }
  td.clickable:hover { background: var(--hover); }
  pre.stdout {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px;
    margin: 0;
    font-size: 11px;
    max-height: 140px;
    overflow: auto;
    white-space: pre-wrap;
  }
  .empty {
    color: var(--muted);
    padding: 16px 8px;
    text-align: center;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span id="livePill" class="pill live">LIVE</span>
    <button id="toggleBtn" class="secondary">Pause</button>
    <button id="runBtn">Run Now</button>
    <span id="metaPill" class="pill" style="display:none"></span>
  </div>

  <div class="ref-bar" style="margin-bottom:6px;" title="Command-line arguments passed to sys.argv / main(argc, argv)">
    <span style="color:var(--muted)">Args:</span>
    <input id="argsInput" type="text" placeholder="e.g. databases/small.csv sequences/1.txt"
      style="flex:1; background:transparent; color:var(--fg); border:none; outline:none; font-family:var(--vscode-editor-font-family, monospace); font-size:11px;" />
  </div>

  <div class="ref-bar" id="refBar" title="Click any item below to see how to reference it in code">
    <span style="color:var(--muted)">Ref:</span>
    <code id="refCode">Click any variable or nested item...</code>
    <button id="copyRefBtn" class="secondary" style="padding:2px 6px;">Copy</button>
  </div>

  <div class="used-bar" id="usedBar"></div>

  <div class="guide-card" id="guideCard"></div>

  <div id="content">
    <div class="empty">Open a Python, C, or C++ file to see live function scopes, variables, and data structures here.</div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  let state = { trace: null, isLive: true };
  let selectedCallIndex = 0;
  let currentRef = '';
  const selectedStepByCall = new Map();
  const expandedPaths = new Set();
  const tableModePaths = new Set();

  document.getElementById('toggleBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleLive' });
  });
  document.getElementById('runBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'runNow' });
  });
  document.getElementById('copyRefBtn').addEventListener('click', () => {
    if (currentRef) vscode.postMessage({ type: 'copyRef', ref: currentRef });
  });
  const argsInput = document.getElementById('argsInput');
  argsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      vscode.postMessage({ type: 'setArgs', argsText: argsInput.value });
    }
  });
  argsInput.addEventListener('blur', () => {
    vscode.postMessage({ type: 'setArgs', argsText: argsInput.value });
  });

  function setRef(expr) {
    currentRef = expr;
    document.getElementById('refCode').textContent = expr;
  }

  function isTabularList(val) {
    if (!val || val.kind !== 'list' || !val.entries || val.entries.length === 0) return false;
    const first = val.entries[0].value;
    return first && (first.kind === 'dict' || first.kind === 'list' || first.kind === 'object');
  }

  function renderTable(val, baseRef) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const first = val.entries[0].value;
    const cols = [];
    const seen = new Set();

    for (const row of val.entries) {
      if (row.value && row.value.entries) {
        for (const cell of row.value.entries) {
          if (!seen.has(cell.key)) {
            seen.add(cell.key);
            cols.push({ key: cell.key, accessExpr: cell.accessExpr });
          }
        }
      }
    }

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const idxTh = document.createElement('th');
    idxTh.textContent = '#';
    htr.appendChild(idxTh);
    for (const col of cols) {
      const th = document.createElement('th');
      th.textContent = col.key;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of val.entries) {
      const tr = document.createElement('tr');
      const idxTd = document.createElement('td');
      idxTd.textContent = row.key;
      idxTd.className = 'clickable';
      idxTd.onclick = () => setRef(baseRef + row.accessExpr);
      tr.appendChild(idxTd);

      const cellMap = new Map();
      if (row.value && row.value.entries) {
        for (const c of row.value.entries) cellMap.set(c.key, c);
      }
      for (const col of cols) {
        const td = document.createElement('td');
        const cell = cellMap.get(col.key);
        td.textContent = cell ? cell.value.preview : '—';
        if (cell) {
          td.className = 'clickable';
          td.title = 'Click to see reference: ' + baseRef + row.accessExpr + cell.accessExpr;
          td.onclick = () => setRef(baseRef + row.accessExpr + cell.accessExpr);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderValueNode(name, val, pathId, refExpr, aliasRef) {
    const container = document.createElement('div');
    const hasChildren = val.entries && val.entries.length > 0;
    const isExpanded = expandedPaths.has(pathId);

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.varName = name;
    row.dataset.pathId = pathId;
    row.title = aliasRef ? ('Reference: ' + refExpr + ' (points to ' + aliasRef + ')') : ('Reference: ' + refExpr);

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = hasChildren ? (isExpanded ? '▾' : '▸') : '·';
    row.appendChild(toggle);

    const nameEl = document.createElement('span');
    nameEl.className = 'var-name';
    nameEl.textContent = name;
    row.appendChild(nameEl);

    if (aliasRef) {
      const aliasEl = document.createElement('span');
      aliasEl.className = 'alias-tag';
      aliasEl.textContent = '= ' + aliasRef;
      aliasEl.title = 'This variable currently points to ' + aliasRef;
      row.appendChild(aliasEl);
    }

    const typeEl = document.createElement('span');
    typeEl.className = 'type-tag';
    typeEl.textContent = val.length !== undefined ? val.typeName + '(' + val.length + ')' : val.typeName;
    row.appendChild(typeEl);

    if (isTabularList(val)) {
      const tblBtn = document.createElement('button');
      tblBtn.className = 'secondary';
      tblBtn.style.padding = '0px 4px';
      tblBtn.style.fontSize = '9.5px';
      tblBtn.textContent = tableModePaths.has(pathId) ? 'Tree' : 'Table';
      tblBtn.onclick = (e) => {
        e.stopPropagation();
        if (tableModePaths.has(pathId)) tableModePaths.delete(pathId);
        else {
          tableModePaths.add(pathId);
          expandedPaths.add(pathId);
        }
        render();
      };
      row.appendChild(tblBtn);
    }

    const prevEl = document.createElement('span');
    prevEl.className = 'preview';
    prevEl.textContent = val.preview;
    row.appendChild(prevEl);

    row.onclick = () => {
      setRef(refExpr);
      if (hasChildren) {
        if (expandedPaths.has(pathId)) expandedPaths.delete(pathId);
        else expandedPaths.add(pathId);
        render();
      }
    };

    container.appendChild(row);

    if (hasChildren && isExpanded) {
      if (tableModePaths.has(pathId) && isTabularList(val)) {
        container.appendChild(renderTable(val, refExpr));
      } else {
        const childrenWrap = document.createElement('div');
        childrenWrap.className = 'tree-node';
        for (const entry of val.entries) {
          const childRef = refExpr + entry.accessExpr;
          const childPath = pathId + '/' + entry.key;
          childrenWrap.appendChild(renderValueNode(entry.key, entry.value, childPath, childRef));
        }
        if (val.truncated) {
          const more = document.createElement('div');
          more.style.color = 'var(--muted)';
          more.style.padding = '2px 6px';
          more.textContent = '... (more items truncated)';
          childrenWrap.appendChild(more);
        }
        container.appendChild(childrenWrap);
      }
    }

    return container;
  }

  function renderVarMap(title, map, prefix, aliases) {
    const entries = Object.entries(map || {});
    if (entries.length === 0) return null;
    const sec = document.createElement('div');
    sec.className = 'section';
    const header = document.createElement('div');
    header.className = 'section-title';
    header.textContent = title + ' (' + entries.length + ')';
    sec.appendChild(header);
    for (const [k, v] of entries) {
      const aliasRef = aliases && aliases[k] ? aliases[k] : undefined;
      sec.appendChild(renderValueNode(k, v, prefix + ':' + k, k, aliasRef));
    }
    return sec;
  }

  function render() {
    const livePill = document.getElementById('livePill');
    const toggleBtn = document.getElementById('toggleBtn');
    const metaPill = document.getElementById('metaPill');
    const content = document.getElementById('content');

    livePill.textContent = state.isLive ? 'LIVE' : 'PAUSED';
    livePill.className = 'pill ' + (state.isLive ? 'live' : 'paused');
    toggleBtn.textContent = state.isLive ? 'Pause' : 'Resume';

    const trace = state.trace;
    if (!trace) {
      metaPill.style.display = 'none';
      content.innerHTML = '<div class="empty">Open a Python, C, or C++ file to see live function scopes, variables, and data structures here.</div>';
      return;
    }

    metaPill.style.display = 'inline-block';
    metaPill.textContent = trace.language.toUpperCase() + ' · ' + trace.durationMs + 'ms';
    content.innerHTML = '';

    if (trace.error) {
      const errBox = document.createElement('div');
      errBox.className = 'error-box';
      const title = document.createElement('div');
      title.innerHTML = '<strong>' + trace.error.kind.toUpperCase() + ' ERROR</strong>' +
        (trace.error.line ? ' (<span class="error-line">Line ' + trace.error.line + '</span>)' : '');
      if (trace.error.line) {
        title.querySelector('.error-line').onclick = () => {
          vscode.postMessage({ type: 'jumpToLine', line: trace.error.line });
        };
      }
      const msg = document.createElement('div');
      msg.style.marginTop = '4px';
      msg.textContent = trace.error.message;
      errBox.appendChild(title);
      errBox.appendChild(msg);
      content.appendChild(errBox);
    }

    if (trace.calls && trace.calls.length > 0) {
      if (selectedCallIndex >= trace.calls.length) selectedCallIndex = 0;
      const callSec = document.createElement('div');
      callSec.className = 'section';
      const cTitle = document.createElement('div');
      cTitle.className = 'section-title';
      cTitle.textContent = 'Function Scope (' + trace.calls.length + ' calls)';
      callSec.appendChild(cTitle);

      const sel = document.createElement('select');
      trace.calls.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        const indent = '  '.repeat(c.depth || 0);
        const ret = c.returnValue ? ' -> ' + c.returnValue.preview : '';
        opt.textContent = indent + c.name + '() [line ' + c.callLine + ']' + ret;
        if (idx === selectedCallIndex) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        selectedCallIndex = Number(sel.value);
        render();
      };
      callSec.appendChild(sel);
      content.appendChild(callSec);

      const activeCall = trace.calls[selectedCallIndex];
      const events = activeCall.events || [];
      let displayedLocals = activeCall.locals;
      let displayedAliases = undefined;

      if (events.length > 0) {
        let stepIdx = selectedStepByCall.has(activeCall.id)
          ? selectedStepByCall.get(activeCall.id)
          : events.length - 1;
        if (stepIdx >= events.length) stepIdx = events.length - 1;
        if (stepIdx < 0) stepIdx = 0;

        const ev = events[stepIdx];
        displayedLocals = ev.locals;
        displayedAliases = ev.aliases;

        const stepSec = document.createElement('div');
        stepSec.className = 'section';
        const sTitle = document.createElement('div');
        sTitle.className = 'section-title';
        sTitle.innerHTML = '<span>Execution Timeline</span><span>Line ' + ev.line + '</span>';
        stepSec.appendChild(sTitle);

        const bar = document.createElement('div');
        bar.className = 'step-bar';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'secondary';
        prevBtn.textContent = '◀';
        prevBtn.disabled = stepIdx === 0;
        prevBtn.onclick = () => {
          selectedStepByCall.set(activeCall.id, Math.max(0, stepIdx - 1));
          vscode.postMessage({ type: 'jumpToLine', line: events[Math.max(0, stepIdx - 1)].line });
          render();
        };

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = String(events.length - 1);
        slider.value = String(stepIdx);
        slider.oninput = () => {
          const next = Number(slider.value);
          selectedStepByCall.set(activeCall.id, next);
          vscode.postMessage({ type: 'jumpToLine', line: events[next].line });
          render();
        };

        const nextBtn = document.createElement('button');
        nextBtn.className = 'secondary';
        nextBtn.textContent = '▶';
        nextBtn.disabled = stepIdx >= events.length - 1;
        nextBtn.onclick = () => {
          selectedStepByCall.set(activeCall.id, Math.min(events.length - 1, stepIdx + 1));
          vscode.postMessage({ type: 'jumpToLine', line: events[Math.min(events.length - 1, stepIdx + 1)].line });
          render();
        };

        const lbl = document.createElement('span');
        lbl.className = 'step-label';
        lbl.textContent = (stepIdx + 1) + '/' + events.length;

        bar.appendChild(prevBtn);
        bar.appendChild(slider);
        bar.appendChild(nextBtn);
        bar.appendChild(lbl);
        stepSec.appendChild(bar);
        content.appendChild(stepSec);
      }

      const argsSec = renderVarMap('Arguments', activeCall.args, activeCall.id + ':arg');
      if (argsSec) content.appendChild(argsSec);

      const localsSec = renderVarMap('Variables Inside Scope', displayedLocals, activeCall.id + ':loc', displayedAliases);
      if (localsSec) content.appendChild(localsSec);

      if (activeCall.returnValue) {
        const retSec = document.createElement('div');
        retSec.className = 'section';
        const rTitle = document.createElement('div');
        rTitle.className = 'section-title';
        rTitle.textContent = 'Return Value';
        retSec.appendChild(rTitle);
        retSec.appendChild(renderValueNode('return', activeCall.returnValue, activeCall.id + ':ret', 'return'));
        content.appendChild(retSec);
      }
    } else if (!trace.error) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No variables or function calls captured yet.';
      content.appendChild(empty);
    }

    if (trace.stdout) {
      const outSec = document.createElement('div');
      outSec.className = 'section';
      const oTitle = document.createElement('div');
      oTitle.className = 'section-title';
      oTitle.textContent = 'Program Output (stdout)';
      outSec.appendChild(oTitle);
      const pre = document.createElement('pre');
      pre.className = 'stdout';
      pre.textContent = trace.stdout;
      outSec.appendChild(pre);
      content.appendChild(outSec);
    }
  }

  function renderUsedBar(name, usedLines) {
    const bar = document.getElementById('usedBar');
    bar.innerHTML = '';
    if (!usedLines || usedLines.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const lbl = document.createElement('span');
    lbl.style.color = 'var(--muted)';
    lbl.textContent = name + ' used on:';
    bar.appendChild(lbl);
    for (const ln of usedLines.slice(0, 12)) {
      const chip = document.createElement('button');
      chip.className = 'line-chip';
      chip.textContent = 'L' + ln;
      chip.title = 'Jump to line ' + ln;
      chip.onclick = () => vscode.postMessage({ type: 'jumpToLine', line: ln });
      bar.appendChild(chip);
    }
    if (usedLines.length > 12) {
      const more = document.createElement('span');
      more.style.color = 'var(--muted)';
      more.textContent = '+' + (usedLines.length - 12) + ' more';
      bar.appendChild(more);
    }
  }

  function focusVariableInPanel(name, line, usedLines) {
    renderUsedBar(name, usedLines);
    if (!state.trace || !state.trace.calls || state.trace.calls.length === 0) return;

    let bestCallIdx = -1;
    let bestStepIdx = -1;

    // 1. Prefer a call that executed line and has name
    state.trace.calls.forEach((c, idx) => {
      const evIdx = (c.events || []).findIndex(
        (ev) => ev.line === line && ev.locals && Object.prototype.hasOwnProperty.call(ev.locals, name)
      );
      if (evIdx !== -1 && bestCallIdx === -1) {
        bestCallIdx = idx;
        bestStepIdx = evIdx;
      }
    });

    // 2. Fallback: any call where name is in args or locals
    if (bestCallIdx === -1) {
      bestCallIdx = state.trace.calls.findIndex(
        (c) =>
          (c.args && Object.prototype.hasOwnProperty.call(c.args, name)) ||
          (c.locals && Object.prototype.hasOwnProperty.call(c.locals, name))
      );
    }

    if (bestCallIdx === -1) return;

    selectedCallIndex = bestCallIdx;
    const call = state.trace.calls[bestCallIdx];
    if (bestStepIdx !== -1) {
      selectedStepByCall.set(call.id, bestStepIdx);
    }

    // Auto-expand the variable in both arg and loc sections
    expandedPaths.add(call.id + ':loc:' + name);
    expandedPaths.add(call.id + ':arg:' + name);
    setRef(name);
    render();

    const rows = document.querySelectorAll('.tree-row');
    for (const r of rows) {
      if (r.dataset.varName === name) {
        r.classList.add('flash');
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => r.classList.remove('flash'), 1600);
        break;
      }
    }
  }

  function renderGuide(guide) {
    const card = document.getElementById('guideCard');
    card.innerHTML = '';
    if (!guide) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';

    const hdr = document.createElement('div');
    hdr.className = 'guide-header';
    const sig = document.createElement('span');
    sig.className = 'guide-sig';
    sig.textContent = guide.signature;
    const src = document.createElement('span');
    src.className = 'pill';
    src.textContent = guide.source;
    hdr.appendChild(sig);
    hdr.appendChild(src);
    card.appendChild(hdr);

    if (guide.plainEnglish) {
      const simpleEl = document.createElement('div');
      simpleEl.className = 'guide-simple';
      simpleEl.innerHTML = '<strong>In Plain English:</strong> <span></span>';
      simpleEl.querySelector('span').textContent = guide.plainEnglish;
      card.appendChild(simpleEl);
    }

    if (guide.doc) {
      const docEl = document.createElement('pre');
      docEl.className = 'guide-doc';
      docEl.textContent = guide.doc;
      card.appendChild(docEl);
    }

    if (guide.loopExamples && guide.loopExamples.length > 0) {
      const loopWrap = document.createElement('div');
      loopWrap.className = 'guide-params';
      const lTitle = document.createElement('div');
      lTitle.style.color = 'var(--muted)';
      lTitle.style.marginBottom = '3px';
      lTitle.textContent = 'Loop over this:';
      loopWrap.appendChild(lTitle);
      for (const lp of guide.loopExamples) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '6px';
        row.style.marginBottom = '3px';
        const left = document.createElement('div');
        left.innerHTML = '<code></code><div style="color:var(--muted); font-size:10px;"></div>';
        left.querySelector('code').textContent = lp.code;
        left.querySelector('div').textContent = lp.note;
        const cp = document.createElement('button');
        cp.className = 'secondary';
        cp.style.padding = '1px 5px';
        cp.style.fontSize = '10px';
        cp.textContent = 'Copy';
        cp.onclick = () => vscode.postMessage({ type: 'copyRef', ref: lp.code });
        row.appendChild(left);
        row.appendChild(cp);
        loopWrap.appendChild(row);
      }
      card.appendChild(loopWrap);
    }

    if ((guide.params && guide.params.length > 0) || guide.returnInfo) {
      const pWrap = document.createElement('div');
      pWrap.className = 'guide-params';
      if (guide.params) {
        for (const p of guide.params) {
          const line = document.createElement('div');
          line.innerHTML = '<strong>' + p.name + '</strong>: <span style="color:var(--muted)"></span>';
          line.querySelector('span').textContent = p.detail;
          pWrap.appendChild(line);
        }
      }
      if (guide.returnInfo) {
        const rLine = document.createElement('div');
        rLine.innerHTML = '<strong>returns</strong>: <span style="color:var(--muted)"></span>';
        rLine.querySelector('span').textContent = guide.returnInfo;
        pWrap.appendChild(rLine);
      }
      card.appendChild(pWrap);
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'state') {
      state.trace = msg.trace;
      state.isLive = msg.isLive;
      if (typeof msg.argsText === 'string' && document.activeElement !== argsInput) {
        argsInput.value = msg.argsText;
      }
      if (msg.guide !== undefined) renderGuide(msg.guide);
      render();
    } else if (msg.type === 'guide') {
      renderGuide(msg.guide);
    } else if (msg.type === 'focusVar') {
      focusVariableInPanel(msg.name, msg.line, msg.usedLines || []);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
