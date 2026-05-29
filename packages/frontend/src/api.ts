const BASE = '/api';

function encodePath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

export async function listFiles(): Promise<string[]> {
  const r = await fetch(`${BASE}/files`);
  return r.json();
}

export async function getFile(name: string): Promise<string> {
  const r = await fetch(`${BASE}/files/${encodePath(name)}`);
  if (!r.ok) throw new Error('File not found');
  return r.text();
}

export async function saveFile(name: string, content: string): Promise<void> {
  await fetch(`${BASE}/files/${encodePath(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function getLayout(name: string): Promise<Record<string, { x: number; y: number }>> {
  const r = await fetch(`${BASE}/layouts/${encodePath(name)}`);
  return r.json();
}

export async function saveLayout(name: string, layout: Record<string, { x: number; y: number }>): Promise<void> {
  await fetch(`${BASE}/layouts/${encodePath(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
}

export type HeadSnapshot = {
  /** File contents at git HEAD, or null when the file is untracked/new. */
  source: string | null;
  layout: Record<string, { x: number; y: number; width?: number; height?: number }>;
};

export async function getHead(name: string): Promise<HeadSnapshot> {
  const r = await fetch(`${BASE}/head/${encodePath(name)}`);
  if (!r.ok) return { source: null, layout: {} };
  return r.json();
}
