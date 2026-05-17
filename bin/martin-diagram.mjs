#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

function printHelp() {
  console.log(`martin-diagram\n\nUsage:\n  martin-diagram [options]               Start the editor server\n  martin-diagram parse <file>            Parse a .diagram file and report errors\n\nServer options:\n  --port <number>    Port for server and UI (default: 3001 or PORT env)\n  --dir <path>       Diagram directory to watch (default: current directory)\n  --no-open          Do not open browser automatically\n  -h, --help         Show this help\n`);
}

function parseArgs(argv) {
  let port = process.env.PORT ?? '3001';
  let openBrowser = true;
  let targetDir = process.cwd();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--no-open') {
      openBrowser = false;
      continue;
    }

    if (arg === '--port' || arg === '-p') {
      const next = argv[i + 1];
      if (!next) {
        console.error('Missing value for --port');
        process.exit(1);
      }
      port = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
      continue;
    }

    if (arg === '--dir') {
      const next = argv[i + 1];
      if (!next) {
        console.error('Missing value for --dir');
        process.exit(1);
      }
      targetDir = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--dir=')) {
      targetDir = arg.slice('--dir='.length);
      continue;
    }

    console.error(`Unknown option: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return {
    port: String(port),
    openBrowser,
    targetDir: resolve(targetDir),
  };
}

function openUrl(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

const thisFile = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(thisFile), '..');
const backendEntry = join(rootDir, 'packages', 'backend', 'dist', 'index.js');
const frontendEntry = join(rootDir, 'packages', 'frontend', 'dist', 'index.html');
const parserEntry = join(rootDir, 'packages', 'parser', 'dist', 'index.js');

async function runParseCommand(rawArgs) {
  if (rawArgs.length === 0 || rawArgs[0] === '-h' || rawArgs[0] === '--help') {
    console.log('Usage: martin-diagram parse <file>');
    process.exit(rawArgs.length === 0 ? 1 : 0);
  }
  const file = resolve(rawArgs[0]);
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  if (!existsSync(parserEntry)) {
    console.log('Building parser...');
    const build = spawnSync('pnpm', ['--dir', rootDir, '--filter', '@diagram/parser', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const { parse, inferEdges } = await import(pathToFileURL(parserEntry).href);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  try {
    const ast = parse(text);
    const edges = inferEdges(ast);

    let leafCount = 0;
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.kind === 'Service') walk(n.children);
        else leafCount++;
      }
    };
    walk(ast.nodes);

    console.log(`OK: ${ast.nodes.length} top-level node(s), ${leafCount} leaf node(s), ${edges.length} edge(s).`);
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Parse error: ${msg}`);
    const m = msg.match(/at line (\d+)/);
    if (m) {
      const ln = parseInt(m[1], 10);
      const from = Math.max(1, ln - 2);
      const to = Math.min(lines.length, ln + 2);
      console.error('');
      for (let i = from; i <= to; i++) {
        const marker = i === ln ? '>' : ' ';
        console.error(`${marker} ${String(i).padStart(4)} | ${lines[i - 1] ?? ''}`);
      }
    }
    process.exit(1);
  }
}

if (process.argv[2] === 'parse') {
  await runParseCommand(process.argv.slice(3));
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(backendEntry) || !existsSync(frontendEntry)) {
  console.log('Building martin-diagram...');
  const build = spawnSync('pnpm', ['--dir', rootDir, 'build'], { stdio: 'inherit' });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const env = {
  ...process.env,
  PORT: args.port,
  DIAGRAM_DIR: args.targetDir,
};

const child = spawn(process.execPath, [backendEntry], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env,
});

console.log(`martin-diagram directory: ${args.targetDir}`);

// Read backend stdout to capture the actual bound port, forward everything else
let leftover = '';
let urlAnnounced = false;

child.stdout.on('data', (chunk) => {
  const text = leftover + chunk.toString();
  const lines = text.split('\n');
  leftover = lines.pop() ?? '';
  for (const line of lines) {
    if (!urlAnnounced && line.startsWith('MARTIN_PORT:')) {
      const port = line.slice('MARTIN_PORT:'.length).trim();
      const url = `http://localhost:${port}`;
      console.log(`martin-diagram url: ${url}`);
      urlAnnounced = true;
      if (args.openBrowser) {
        try { openUrl(url); } catch { /* best-effort */ }
      }
    } else {
      process.stdout.write(line + '\n');
    }
  }
});

child.stdout.on('end', () => {
  if (leftover) process.stdout.write(leftover);
});

const forwardSignal = (signal) => {
  if (child.killed) return;
  child.kill(signal);
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
