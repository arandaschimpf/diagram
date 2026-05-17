import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import { registerDiagramLanguage, LANG_ID } from './monacoLanguage';
import { FileSidebar } from './components/FileSidebar';
import { DiagramCanvas } from './components/DiagramCanvas';
import { useFileSync } from './hooks/useFileSync';
import { dslToFlow } from './dslToFlow';
import type { Layout } from './dslToFlow';
import { addEdgeToCode, removeEdgeFromCode, type TargetKind } from './editDsl';

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

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerDiagramLanguage(monaco);
  }, []);

  const handleEditorMount: OnMount = useCallback((e) => { editorRef.current = e; }, []);

  const xyTypeToKeyword: Record<string, string> = {
    entity: 'Entity', event: 'Event', eventhandler: 'EventHandler',
    query: 'Query', action: 'Action', xor: 'XOR', service: 'Service',
  };

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

  const { nodes, edges } = useMemo(
    () => dslToFlow(code, layout),
    [code, layout],
  );

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
            <DiagramCanvas
              key={currentFile}
              nodes={nodes}
              edges={edges}
              filename={currentFile ?? undefined}
              currentLayout={layout}
              onLayoutChange={handleLayoutChange}
              onNodeRightClick={handleNodeRightClick}
              onAddEdge={handleAddEdge}
              onDeleteEdge={handleDeleteEdge}
            />
          </div>
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
    overflow: 'hidden',
    position: 'relative',
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
