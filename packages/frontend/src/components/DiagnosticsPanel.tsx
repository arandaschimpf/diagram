import { useState } from 'react';
import type { Diagnostic } from '@diagram/parser';

type Props = {
  diagnostics: Diagnostic[];
  onJumpToLine: (line: number) => void;
};

export function DiagnosticsPanel({ diagnostics, onJumpToLine }: Props) {
  const [expanded, setExpanded] = useState(false);

  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');
  const hasAny = diagnostics.length > 0;

  return (
    <div style={styles.root}>
      <button
        style={styles.header}
        onClick={() => setExpanded(v => !v)}
      >
        <span style={styles.caret}>{expanded ? '▼' : '▶'}</span>
        <span style={styles.title}>Problems</span>
        {hasAny ? (
          <>
            {errors.length > 0 && (
              <span style={styles.errorBadge}>{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
            )}
            {warnings.length > 0 && (
              <span style={styles.warnBadge}>{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
            )}
          </>
        ) : (
          <span style={styles.okBadge}>no problems</span>
        )}
      </button>

      {expanded && hasAny && (
        <div style={styles.list}>
          {diagnostics.map((d, i) => (
            <button
              key={i}
              style={styles.row}
              onClick={() => d.line && onJumpToLine(d.line)}
              title={d.line ? `Jump to line ${d.line}` : undefined}
            >
              <span style={d.severity === 'error' ? styles.errIcon : styles.warnIcon}>
                {d.severity === 'error' ? '⊗' : '⚠'}
              </span>
              <span style={styles.message}>{d.message}</span>
              {d.line && <span style={styles.lineRef}>line {d.line}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: '#1a1a1a',
    borderTop: '1px solid #333',
    fontFamily: 'monospace',
    fontSize: 12,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '40vh',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: '#bbb',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  caret: {
    fontSize: 9,
    color: '#888',
    width: 10,
  },
  title: {
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    fontSize: 11,
    color: '#ccc',
  },
  errorBadge: {
    background: '#5a1a1a',
    color: '#ff9a9a',
    padding: '1px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  warnBadge: {
    background: '#5a4a1a',
    color: '#ffd070',
    padding: '1px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  okBadge: {
    color: '#5a8a5a',
    fontSize: 11,
    fontStyle: 'italic',
  },
  list: {
    overflowY: 'auto',
    borderTop: '1px solid #2a2a2a',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '5px 12px 5px 24px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #222',
    color: '#ccc',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    width: '100%',
  },
  errIcon: { color: '#ff6a6a', fontSize: 13, lineHeight: '16px', width: 14, flexShrink: 0 },
  warnIcon: { color: '#ffc060', fontSize: 13, lineHeight: '16px', width: 14, flexShrink: 0 },
  message: { flex: 1, whiteSpace: 'pre-wrap', lineHeight: '16px' },
  lineRef: { color: '#777', flexShrink: 0, fontSize: 11, lineHeight: '16px' },
};
