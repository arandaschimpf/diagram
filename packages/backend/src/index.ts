import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createServer } from 'net';
import { join, resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';
import { parse as parseDiagram, diffRenames, migrateLayout, type AST, type Layout } from '@diagram/parser';

function findPort(preferred: number): Promise<number> {
  return new Promise((res) => {
    const probe = createServer();
    probe.once('error', () => res(findPort(preferred + 1)));
    probe.once('listening', () => probe.close(() => res(preferred)));
    probe.listen(preferred, '0.0.0.0');
  });
}

interface WSClient {
  OPEN: number;
  readyState: number;
  send: (payload: string) => void;
  on: (event: 'close', listener: () => void) => void;
}

const FILES_DIR = resolve(process.env.DIAGRAM_DIR ?? process.cwd());
const PORT = await findPort(parseInt(process.env.PORT ?? '3001'));
const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST_DIR = resolve(__dirname, '../../frontend/dist');
const SERVE_FRONTEND = existsSync(join(FRONTEND_DIST_DIR, 'index.html'));

const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true });
await app.register(websocket);

// ── File helpers ──────────────────────────────────────────────────────────────

function diagramPath(name: string) {
  const rel = name.replace(/^\/+/, '');
  const withExt = rel.endsWith('.diagram') ? rel : `${rel}.diagram`;
  const p = resolve(FILES_DIR, withExt);
  if (p !== FILES_DIR && !p.startsWith(FILES_DIR + sep)) throw new Error('Path traversal');
  return p;
}

function layoutPath(name: string) {
  return diagramPath(name).replace(/\.diagram$/, '.layout.json');
}

function relName(absPath: string): string {
  return relative(FILES_DIR, absPath).split(sep).join('/');
}

async function* walkDiagrams(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkDiagrams(full);
    else if (e.isFile() && e.name.endsWith('.diagram')) yield full;
  }
}

// ── REST endpoints ────────────────────────────────────────────────────────────

app.get('/api/files', async () => {
  const result: string[] = [];
  for await (const full of walkDiagrams(FILES_DIR)) {
    result.push(relName(full).replace(/\.diagram$/, ''));
  }
  return result.sort();
});

// Per-file AST cache used to detect renames between successive parses.
// Keyed by the user-facing filename (the `*` route param, without `.diagram`).
const astCache = new Map<string, AST>();

function tryParse(text: string): AST | null {
  try { return parseDiagram(text); } catch { return null; }
}

app.get<{ Params: { '*': string } }>('/api/files/*', async (req, reply) => {
  const name = req.params['*'];
  const p = diagramPath(name);
  if (!existsSync(p)) return reply.code(404).send({ error: 'Not found' });
  const text = await readFile(p, 'utf8');
  // Warm the AST cache so the very next change has something to diff against.
  const ast = tryParse(text);
  if (ast) astCache.set(name, ast);
  return reply.type('text/plain').send(text);
});

app.post<{ Params: { '*': string }; Body: string }>('/api/files/*', {
  config: { rawBody: true },
}, async (req, reply) => {
  const p = diagramPath(req.params['*']);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, req.body as string, 'utf8');
  return reply.code(200).send({ ok: true });
});

app.post<{ Body: string }>('/api/parse', {
  config: { rawBody: true },
}, async (req, reply) => {
  try {
    const ast = parseDiagram(req.body as string);
    return reply.send({ ast });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(422).send({ error: { message } });
  }
});

app.get<{ Params: { '*': string } }>('/api/layouts/*', async (req, reply) => {
  const p = layoutPath(req.params['*']);
  if (!existsSync(p)) return reply.send({});
  return reply.send(JSON.parse(await readFile(p, 'utf8')));
});

app.put<{ Params: { '*': string }; Body: unknown }>('/api/layouts/*', async (req, reply) => {
  const p = layoutPath(req.params['*']);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(req.body, null, 2), 'utf8');
  return reply.code(200).send({ ok: true });
});

// ── WebSocket file watcher ────────────────────────────────────────────────────

const clients = new Set<WSClient>();

app.get('/api/watch', { websocket: true }, (socket) => {
  const client = socket as unknown as WSClient;
  clients.add(client);
  client.on('close', () => clients.delete(client));
});

const watcher = chokidar.watch(FILES_DIR, {
  ignored: (p: string) => /node_modules/.test(p) || /(^|[\\/])\.[^\\/]/.test(p),
  ignoreInitial: true,
});

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function emit(type: 'change' | 'add' | 'remove', p: string) {
  if (!p.endsWith('.diagram')) return;
  broadcast({ type, file: relName(p).replace(/\.diagram$/, '') });
}

async function migrateLayoutFile(name: string): Promise<boolean> {
  const text = await readFile(diagramPath(name), 'utf8');
  const nextAst = tryParse(text);
  if (!nextAst) return false; // hold last-good AST; skip migration on parse error

  const prevAst = astCache.get(name);
  astCache.set(name, nextAst);
  if (!prevAst) return false; // cold cache (server restart or first edit) — accept the loss

  const renames = diffRenames(prevAst, nextAst);
  if (renames.length === 0) return false;

  const lp = layoutPath(name);
  if (!existsSync(lp)) return false;
  let layout: Layout;
  try {
    layout = JSON.parse(await readFile(lp, 'utf8')) as Layout;
  } catch {
    return false;
  }

  const migrated = migrateLayout(layout, renames);
  if (!migrated) return false;

  await writeFile(lp, JSON.stringify(migrated, null, 2), 'utf8');
  return true;
}

async function handleDiagramChange(type: 'change' | 'add', p: string): Promise<void> {
  const name = relName(p).replace(/\.diagram$/, '');
  let migrated = false;
  try {
    migrated = await migrateLayoutFile(name);
  } catch {
    // best-effort: any failure falls back to today's behaviour (no migration)
  }
  broadcast({ type, file: name });
  if (migrated) broadcast({ type: 'layout-change', file: name });
}

watcher.on('change', p => {
  if (!p.endsWith('.diagram')) return;
  void handleDiagramChange('change', p);
});
watcher.on('add', p => {
  if (!p.endsWith('.diagram')) return;
  void handleDiagramChange('add', p);
});
watcher.on('unlink', p => {
  if (!p.endsWith('.diagram')) return;
  astCache.delete(relName(p).replace(/\.diagram$/, ''));
  emit('remove', p);
});

if (SERVE_FRONTEND) {
  await app.register(staticPlugin, {
    root: FRONTEND_DIST_DIR,
    wildcard: false,
    index: false,
  });

  app.get('/', (_, reply) => reply.sendFile('index.html'));
  app.get('/*', async (_, reply) => {
    return reply.sendFile('index.html');
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

await app.listen({ port: PORT, host: '0.0.0.0' });
// Signal the bound port to the CLI before any other output
process.stdout.write(`MARTIN_PORT:${PORT}\n`);
console.log(`Backend running on http://localhost:${PORT}`);
console.log(`Watching: ${FILES_DIR}`);
if (SERVE_FRONTEND) {
  console.log(`Serving UI from: ${FRONTEND_DIST_DIR}`);
}
