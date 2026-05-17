import { useState, useEffect, useRef, useCallback } from 'react';
import { getFile, saveFile, getLayout, saveLayout } from '../api';
import type { Layout } from '../dslToFlow';

const SAVE_DEBOUNCE_MS = 2000;

export function useFileSync(fileName: string | null) {
  const [code, setCode] = useState('');
  const [layout, setLayout] = useState<Layout>({});
  const [loading, setLoading] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the next file change came from us (so we don't reload our own saves)
  const isSavingRef = useRef(false);

  const loadFile = useCallback((name: string) => {
    setLoading(true);
    Promise.all([getFile(name), getLayout(name)])
      .then(([src, lay]) => { setCode(src); setLayout(lay); })
      .finally(() => setLoading(false));
  }, []);

  // Initial load when file selection changes
  useEffect(() => {
    if (!fileName) return;
    loadFile(fileName);
  }, [fileName, loadFile]);

  // Watch for external edits via backend WebSocket
  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}/api/watch`);

    ws.onmessage = (ev) => {
      if (!fileName) return;
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; file: string };
        if (msg.file !== fileName) return;
        if (msg.type === 'layout-change') {
          // Backend migrated the layout file (e.g. after a rename). Pull fresh.
          getLayout(fileName).then(setLayout);
          return;
        }
        if (msg.type !== 'change' && msg.type !== 'add') return;
        // Skip code reloads triggered by our own in-app saves.
        if (isSavingRef.current) return;
        loadFile(fileName);
      } catch { /* ignore malformed messages */ }
    };

    return () => ws.close();
  }, [fileName, loadFile]);

  const updateCode = useCallback((newCode: string) => {
    setCode(newCode);
    if (!fileName) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      isSavingRef.current = true;
      saveFile(fileName, newCode).finally(() => {
        // Give chokidar a moment to fire before we clear the flag
        setTimeout(() => { isSavingRef.current = false; }, 300);
      });
    }, SAVE_DEBOUNCE_MS);
  }, [fileName]);

  const updateLayout = useCallback((newLayout: Layout) => {
    setLayout(newLayout);
    if (!fileName) return;
    saveLayout(fileName, newLayout);
  }, [fileName]);

  return { code, layout, loading, updateCode, updateLayout };
}
