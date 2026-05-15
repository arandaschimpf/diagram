import { useState, useEffect } from 'react';
import { listFiles, saveFile } from '../api';

interface Props {
  currentFile: string | null;
  onSelect: (name: string) => void;
}

export function FileSidebar({ currentFile, onSelect }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState(false);

  const refresh = () => listFiles().then(setFiles);

  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await saveFile(name, `Service ${name} {\n}\n`);
    setNewName('');
    setCreating(false);
    await refresh();
    onSelect(name);
  };

  return (
    <div
      style={{ ...styles.sidebar, ...(expanded ? styles.sidebarExpanded : styles.sidebarCollapsed) }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div style={styles.header}>{expanded ? 'Files' : '☰'}</div>
      {expanded && (
        <>
          <div style={styles.list}>
            {files.map(f => (
              <div
                key={f}
                style={{ ...styles.file, ...(f === currentFile ? styles.active : {}) }}
                onClick={() => onSelect(f)}
              >
                {f}.diagram
              </div>
            ))}
            {files.length === 0 && <div style={styles.empty}>No .diagram files</div>}
          </div>
          {creating ? (
            <div style={styles.createForm}>
              <input
                autoFocus
                style={styles.input}
                placeholder="filename"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
              />
              <button style={styles.btn} onClick={create}>Create</button>
            </div>
          ) : (
            <button style={styles.btn} onClick={() => setCreating(true)}>+ New file</button>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    background: '#111',
    borderRight: '1px solid #333',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden',
    transition: 'width 0.16s ease',
  },
  sidebarExpanded: {
    width: 180,
  },
  sidebarCollapsed: {
    width: 44,
  },
  header: {
    padding: '10px 12px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#666',
    borderBottom: '1px solid #222',
  },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  file: {
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    color: '#ccc',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  active: { background: '#2a2a3a', color: '#fff' },
  empty: { padding: '10px 12px', color: '#555', fontSize: 12 },
  createForm: { padding: '8px', display: 'flex', flexDirection: 'column', gap: 4 },
  input: {
    background: '#222',
    border: '1px solid #444',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 13,
  },
  btn: {
    margin: '8px',
    padding: '5px',
    background: '#2a2a4a',
    border: '1px solid #445',
    color: '#aac',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
};
