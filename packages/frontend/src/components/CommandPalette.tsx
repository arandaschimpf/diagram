import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';

export type SearchItem = {
  id: string;           // XYFlow node id
  name: string;         // short name
  qualified: string;    // dotted path (Service::Sub::Name)
  kind: string;         // 'Entity' | 'Enum' | 'Event' | ...
};

type Props = {
  open: boolean;
  items: SearchItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
};

function score(item: SearchItem, q: string): number {
  if (!q) return 0;
  const name = item.name.toLowerCase();
  const qual = item.qualified.toLowerCase();
  if (name === q) return 1000;
  if (name.startsWith(q)) return 500 + (50 - Math.min(50, name.length));
  if (name.includes(q)) return 300;
  if (qual.includes(q)) return 100;
  return -1;
}

export function CommandPalette({ open, items, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus on next tick so the input is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .map(it => ({ it, s: score(it, q) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map(x => x.it);
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-idx="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(filtered.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[active];
      if (pick) { onSelect(pick.id); onClose(); }
    }
  };

  return (
    <div style={styles.overlay} onMouseDown={onClose}>
      <div style={styles.panel} onMouseDown={e => e.stopPropagation()}>
        <div style={styles.inputRow}>
          <span style={styles.icon}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Find a node…"
            style={styles.input}
          />
        </div>
        <div ref={listRef} style={styles.list}>
          {filtered.length === 0 && (
            <div style={styles.empty}>No matches</div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); onSelect(it.id); onClose(); }}
              style={{ ...styles.row, ...(i === active ? styles.rowActive : {}) }}
            >
              <span style={styles.kind}>{it.kind}</span>
              <span style={styles.name}>{it.name}</span>
              {it.qualified !== it.name && (
                <span style={styles.qual}>{it.qualified}</span>
              )}
            </div>
          ))}
        </div>
        <div style={styles.footer}>
          <span><kbd style={styles.kbd}>↑</kbd> <kbd style={styles.kbd}>↓</kbd> navigate</span>
          <span><kbd style={styles.kbd}>↵</kbd> select</span>
          <span><kbd style={styles.kbd}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export function nodesToSearchItems(nodes: Node[]): SearchItem[] {
  const items: SearchItem[] = [];
  for (const n of nodes) {
    if (n.type === 'service') {
      const data = n.data as { name?: string };
      const qualified = n.id.replace(/^service::/, '');
      items.push({
        id: n.id,
        name: data.name ?? qualified.split('::').pop() ?? n.id,
        qualified,
        kind: 'Service',
      });
    } else {
      const data = n.data as { node?: { kind?: string; name?: string } };
      const kind = data.node?.kind ?? n.type ?? '';
      items.push({
        id: n.id,
        name: data.node?.name ?? n.id.split('::').pop() ?? n.id,
        qualified: n.id,
        kind,
      });
    }
  }
  return items;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '12vh',
  },
  panel: {
    width: 'min(600px, 90vw)',
    background: '#1e1e1e',
    border: '1px solid #3a3a3a',
    borderRadius: 8,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '70vh',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid #2a2a2a',
  },
  icon: { color: '#888', fontSize: 16 },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#eee',
    fontSize: 15,
    fontFamily: 'inherit',
  },
  list: {
    overflowY: 'auto',
    flex: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    cursor: 'pointer',
    color: '#ccc',
    fontSize: 13,
    borderBottom: '1px solid #232323',
  },
  rowActive: {
    background: '#2a3850',
    color: '#fff',
  },
  kind: {
    color: '#9aaecb',
    fontSize: 11,
    padding: '1px 7px',
    border: '1px solid #3c4a64',
    borderRadius: 10,
    background: '#1a2030',
    flexShrink: 0,
    minWidth: 68,
    textAlign: 'center',
  },
  name: { fontWeight: 600, color: '#fff' },
  qual: { color: '#888', fontSize: 12, marginLeft: 'auto' },
  empty: { padding: '14px 16px', color: '#777', fontStyle: 'italic' },
  footer: {
    display: 'flex',
    gap: 18,
    padding: '6px 16px',
    borderTop: '1px solid #2a2a2a',
    background: '#161616',
    color: '#888',
    fontSize: 11,
  },
  kbd: {
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 3,
    padding: '0 5px',
    fontSize: 10,
    color: '#aaa',
  },
};
