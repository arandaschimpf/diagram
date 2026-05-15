const BASE = '/api';

export async function listFiles(): Promise<string[]> {
  const r = await fetch(`${BASE}/files`);
  return r.json();
}

export async function getFile(name: string): Promise<string> {
  const r = await fetch(`${BASE}/files/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error('File not found');
  return r.text();
}

export async function saveFile(name: string, content: string): Promise<void> {
  await fetch(`${BASE}/files/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function getLayout(name: string): Promise<Record<string, { x: number; y: number }>> {
  const r = await fetch(`${BASE}/files/${encodeURIComponent(name)}/layout`);
  return r.json();
}

export async function saveLayout(name: string, layout: Record<string, { x: number; y: number }>): Promise<void> {
  await fetch(`${BASE}/files/${encodeURIComponent(name)}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
}
