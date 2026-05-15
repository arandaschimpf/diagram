import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createServer } from 'net';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

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
  const p = join(FILES_DIR, name.endsWith('.diagram') ? name : `${name}.diagram`);
  if (!p.startsWith(FILES_DIR)) throw new Error('Path traversal');
  return p;
}

function layoutPath(name: string) {
  return diagramPath(name).replace(/\.diagram$/, '.layout.json');
}

// ── REST endpoints ────────────────────────────────────────────────────────────

app.get('/api/files', async () => {
  const entries = await readdir(FILES_DIR);
  return entries.filter(e => e.endsWith('.diagram')).map(e => e.replace(/\.diagram$/, ''));
});

app.get<{ Params: { name: string } }>('/api/files/:name', async (req, reply) => {
  const p = diagramPath(req.params.name);
  if (!existsSync(p)) return reply.code(404).send({ error: 'Not found' });
  return reply.type('text/plain').send(await readFile(p, 'utf8'));
});

app.post<{ Params: { name: string }; Body: string }>('/api/files/:name', {
  config: { rawBody: true },
}, async (req, reply) => {
  const p = diagramPath(req.params.name);
  await writeFile(p, req.body as string, 'utf8');
  return reply.code(200).send({ ok: true });
});

app.get<{ Params: { name: string } }>('/api/files/:name/layout', async (req, reply) => {
  const p = layoutPath(req.params.name);
  if (!existsSync(p)) return reply.send({});
  return reply.send(JSON.parse(await readFile(p, 'utf8')));
});

app.put<{ Params: { name: string }; Body: unknown }>('/api/files/:name/layout', async (req, reply) => {
  const p = layoutPath(req.params.name);
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
  ignored: /node_modules/,
  ignoreInitial: true,
  depth: 0,
});

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

watcher.on('change', p => broadcast({ type: 'change', file: p }));
watcher.on('add', p => broadcast({ type: 'add', file: p }));
watcher.on('unlink', p => broadcast({ type: 'remove', file: p }));

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
