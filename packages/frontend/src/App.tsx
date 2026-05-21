import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Editor, { type OnMount, type BeforeMount, type Monaco } from '@monaco-editor/react';
import { registerDiagramLanguage, LANG_ID } from './monacoLanguage';
import { FileSidebar } from './components/FileSidebar';
import { DiagramCanvas } from './components/DiagramCanvas';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { CommandPalette, nodesToSearchItems } from './components/CommandPalette';
import { StateMachineModal } from './components/StateMachineModal';
import type { StateMachineNode } from '@diagram/parser';
import type { FocusTarget } from './components/DiagramCanvas';
import { useFileSync } from './hooks/useFileSync';
import { useDiagnostics } from './hooks/useDiagnostics';
import { dslToFlow } from './dslToFlow';
import type { Layout } from './dslToFlow';
import { addEdgeToCode, removeEdgeFromCode, type TargetKind } from './editDsl';
import type { Node } from '@xyflow/react';

function enclosingServices(code: string, cursorLine: number): string[] {
  const lines = code.split('\n');
  const stack: { name: string; openDepth: number }[] = [];
  let depth = 0;
  const lastIdx = Math.min(cursorLine, lines.length);
  for (let li = 0; li < lastIdx; li++) {
    const raw = lines[li];
    const commentIdx = raw.indexOf('//');
    const line = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;
    const decl = line.match(/^\s*(?:external\s+)?Service\s+(\w+)\s*\{/);
    if (decl) {
      stack.push({ name: decl[1], openDepth: depth });
      depth++;
      const after = line.slice(decl[0].length);
      for (const ch of after) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          while (stack.length && stack[stack.length - 1].openDepth >= depth) stack.pop();
        }
      }
    } else {
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          while (stack.length && stack[stack.length - 1].openDepth >= depth) stack.pop();
        }
      }
    }
  }
  return stack.map(s => s.name);
}

function resolveNodeId(word: string, line: number, code: string, nodes: Node[]): string | null {
  const candidates = nodes.filter(n => {
    const id = n.type === 'service' ? n.id.replace(/^service::/, '') : n.id;
    return id.split('::').pop() === word;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  const enclosing = enclosingServices(code, line).join('::');
  const exact = candidates.find(c => {
    const id = c.type === 'service' ? c.id.replace(/^service::/, '') : c.id;
    const parts = id.split('::');
    return parts.slice(0, -1).join('::') === enclosing;
  });
  if (exact) return exact.id;
  return candidates[0].id;
}

const DEFAULT_EDITOR_WIDTH = 420;
const MIN_EDITOR_WIDTH = 200;
const MAX_EDITOR_WIDTH = 1200;

export default function App() {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_EDITOR_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const codeRef = useRef<string>('');
  const focusFromActionRef = useRef<((id: string) => void) | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    registerDiagramLanguage(monaco);
  }, []);

  const handleEditorMount: OnMount = useCallback((e) => {
    editorRef.current = e;
    e.addAction({
      id: 'diagram.centerOnCanvas',
      label: 'Center on canvas',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.4,
      run: (ed) => {
        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return;
        const word = model.getWordAtPosition(pos);
        if (!word) return;
        const id = resolveNodeId(word.word, pos.lineNumber, codeRef.current, nodesRef.current);
        if (id) focusFromActionRef.current?.(id);
      },
    });
  }, []);

  const xyTypeToKeyword: Record<string, string> = {
    entity: 'Entity', enum: 'Enum', event: 'Event', eventhandler: 'EventHandler',
    query: 'Query', action: 'Action', xor: 'XOR', service: 'Service',
  };

  const jumpToLine = useCallback((line: number) => {
    setShowEditor(true);
    const tryJump = () => {
      const ed = editorRef.current;
      if (!ed) return false;
      const model = ed.getModel();
      if (!model) return false;
      const maxCol = model.getLineMaxColumn(Math.min(line, model.getLineCount()));
      ed.revealLineInCenter(line);
      ed.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: maxCol });
      ed.focus();
      return true;
    };
    if (tryJump()) return;
    const id = setInterval(() => { if (tryJump()) clearInterval(id); }, 30);
    setTimeout(() => clearInterval(id), 1000);
  }, []);

  const handleNodeRightClick = useCallback((nodeId: string, nodeType: string) => {
    const parts = nodeId.split('::');
    const nodeName = parts[parts.length - 1];
    if (!nodeName) return;
    setShowEditor(true);

    const navigate = () => {
      const ed = editorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;
      const lines = model.getLinesContent();
      const keyword = xyTypeToKeyword[nodeType] ?? '[A-Za-z]+';
      const pattern = new RegExp(`\\b${keyword}\\s+${nodeName}\\b`);
      // Skip lines inside [...] blocks (dispatch/options lists) — they contain references, not declarations
      let bracketDepth = 0;
      let lineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (bracketDepth === 0 && pattern.test(line)) { lineIndex = i; break; }
        bracketDepth += (line.match(/\[/g)?.length ?? 0) - (line.match(/\]/g)?.length ?? 0);
      }
      if (lineIndex === -1) return;
      const lineNumber = lineIndex + 1;
      ed.revealLineInCenter(lineNumber);
      ed.setSelection({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: lines[lineIndex].length + 1 });
      ed.focus();
    };

    // Editor may need a moment to mount if it was hidden
    if (editorRef.current) {
      navigate();
    } else {
      const id = setInterval(() => { if (editorRef.current) { clearInterval(id); navigate(); } }, 30);
      setTimeout(() => clearInterval(id), 1000);
    }
  }, []);

  const formatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFormattingRef = useRef(false);

  const { code, layout, loading, updateCode, updateLayout } = useFileSync(currentFile);

  const handleChange = useCallback((v: string | undefined) => {
    updateCode(v ?? '');
    if (isFormattingRef.current) return;
    if (formatTimerRef.current) clearTimeout(formatTimerRef.current);
    formatTimerRef.current = setTimeout(() => {
      isFormattingRef.current = true;
      editorRef.current?.getAction('editor.action.formatDocument')?.run().then(() => {
        isFormattingRef.current = false;
      });
    }, 5000);
  }, [updateCode]);

  const [activeView, setActiveView] = useState<string | null>(null);

  const { nodes, edges, views, viewMissing } = useMemo(
    () => dslToFlow(code, layout, activeView),
    [code, layout, activeView],
  );

  // If the active view is renamed or deleted in the DSL, fall back to the full diagram.
  useEffect(() => {
    if (viewMissing) setActiveView(null);
  }, [viewMissing]);

  // Reset active view when switching files.
  useEffect(() => { setActiveView(null); }, [currentFile]);

  const diagnostics = useDiagnostics(code);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openStateMachine, setOpenStateMachine] = useState<StateMachineNode | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const searchItems = useMemo(() => nodesToSearchItems(nodes), [nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handlePaletteSelect = useCallback((nodeId: string) => {
    setFocusTarget({ nodeId, nonce: Date.now() });
  }, []);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => {
    focusFromActionRef.current = (id: string) => setFocusTarget({ nodeId: id, nonce: Date.now() });
  }, []);

  // Push diagnostics to Monaco as squiggle markers
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const markers = diagnostics
      .filter(d => d.line && d.line >= 1 && d.line <= lineCount)
      .map(d => {
        const line = d.line!;
        const endCol = model.getLineMaxColumn(line);
        return {
          severity: d.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: endCol,
        };
      });
    monaco.editor.setModelMarkers(model, 'diagram-dsl', markers);
  }, [diagnostics, showEditor]);

  // Clear pending format when switching files so stale timer doesn't fire on new content
  useEffect(() => {
    if (formatTimerRef.current) clearTimeout(formatTimerRef.current);
    isFormattingRef.current = false;
  }, [currentFile]);

  const handleLayoutChange = (newLayout: Layout) => updateLayout(newLayout);

  const handleAddEdge = useCallback((sourceId: string, targetId: string, targetKind: TargetKind) => {
    const next = addEdgeToCode(code, sourceId, targetId, targetKind);
    if (next !== code) updateCode(next);
  }, [code, updateCode]);

  const handleDeleteEdge = useCallback((sourceId: string, targetId: string, targetKind: TargetKind) => {
    const next = removeEdgeFromCode(code, sourceId, targetId, targetKind);
    if (next !== code) updateCode(next);
  }, [code, updateCode]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = editorWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const next = dragStartWidth.current + (ev.clientX - dragStartX.current);
      setEditorWidth(Math.max(MIN_EDITOR_WIDTH, Math.min(MAX_EDITOR_WIDTH, next)));
    };

    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [editorWidth]);

  return (
    <div style={styles.root}>
      <FileSidebar currentFile={currentFile} onSelect={setCurrentFile} />
      {currentFile ? (
        <div style={styles.workspace}>
          <div style={styles.workspaceTop}>
            {loading && <div style={styles.loading}>Loading…</div>}

            {showEditor && (
              <div style={{ ...styles.editor, width: editorWidth }}>
                <Editor
                  height="100%"
                  defaultLanguage={LANG_ID}
                  theme="diagram-dark"
                  value={code}
                  onChange={handleChange}
                  beforeMount={handleBeforeMount}
                  onMount={handleEditorMount}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                  }}
                />
              </div>
            )}

            {showEditor && (
              <div style={styles.dragHandle} onMouseDown={handleDragStart} />
            )}

            <div style={styles.canvasWrapper}>
              <button
                style={styles.toggleBtn}
                onClick={() => setShowEditor(v => !v)}
                title={showEditor ? 'Hide code editor' : 'Show code editor'}
              >
                {showEditor ? '◀ Hide' : '{ } Code'}
              </button>
              {views.length > 0 && (
                <select
                  style={styles.viewSelect}
                  value={activeView ?? ''}
                  onChange={e => setActiveView(e.target.value || null)}
                  title="Filter the canvas to a named View"
                >
                  <option value="">Full diagram</option>
                  {views.map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </select>
              )}
              <DiagramCanvas
                key={currentFile}
                nodes={nodes}
                edges={edges}
                filename={currentFile ?? undefined}
                currentLayout={activeView ? {} : layout}
                onLayoutChange={activeView ? () => {} : handleLayoutChange}
                onNodeRightClick={handleNodeRightClick}
                onAddEdge={handleAddEdge}
                onDeleteEdge={handleDeleteEdge}
                onOpenStateMachine={setOpenStateMachine}
                focusTarget={focusTarget}
                autoLayoutKey={activeView}
              />
            </div>
          </div>

          <DiagnosticsPanel diagnostics={diagnostics} onJumpToLine={jumpToLine} />
          <CommandPalette
            open={paletteOpen}
            items={searchItems}
            onClose={() => setPaletteOpen(false)}
            onSelect={handlePaletteSelect}
          />
          <StateMachineModal
            machine={openStateMachine}
            onClose={() => setOpenStateMachine(null)}
          />
        </div>
      ) : (
        <div style={styles.empty}>
          <div>Select or create a .diagram file to get started</div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  workspace: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  workspaceTop: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
    minHeight: 0,
  },
  editor: {
    flexShrink: 0,
    overflow: 'hidden',
  },
  dragHandle: {
    width: 5,
    flexShrink: 0,
    background: '#2a2a2a',
    cursor: 'col-resize',
    borderLeft: '1px solid #333',
    borderRight: '1px solid #333',
    transition: 'background 0.15s',
  },
  canvasWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
  },
  toggleBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
    background: '#1e1e2e',
    border: '1px solid #444',
    color: '#aaa',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  viewSelect: {
    position: 'absolute',
    top: 12,
    left: 100,
    zIndex: 10,
    background: '#1e1e2e',
    border: '1px solid #444',
    color: '#aaa',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  loading: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#222',
    color: '#aaa',
    padding: '4px 12px',
    borderRadius: 4,
    zIndex: 10,
    fontSize: 12,
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: 16,
  },
};
