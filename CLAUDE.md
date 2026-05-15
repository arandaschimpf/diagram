# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start all packages in watch/dev mode (recommended for development)
pnpm build        # Build all packages in dependency order: parser → backend → frontend
pnpm start        # Run production server (requires prior build)
```

Individual packages:
```bash
pnpm --filter backend build
pnpm --filter frontend build
pnpm --filter @diagram/parser build
```

CLI usage after `pnpm install:global`:
```bash
martin-diagram [--port <num>] [--dir <path>] [--no-open]
```

## Architecture

Three-package monorepo (`pnpm` workspaces) where both `backend` and `frontend` depend on `@diagram/parser`:

### `packages/parser`
Pure TypeScript DSL parser with no runtime dependencies. Converts `.diagram` text files to an AST and back. Key exports:
- `parse(text)` → AST (array of `Service` nodes, each containing typed child nodes)
- `serialize(ast)` → DSL string
- `inferEdges(ast)` → edges array for XYFlow (based on non-primitive type references between nodes)

Node types: `Entity`, `Event`, `EventHandler`, `Query`, `Action`, `XOR`, and `Service` (container). Services can nest arbitrarily: a `Service` body may contain both other `Service` nodes and leaf nodes. The AST root is `{ nodes: DiagramNode[] }` — a flat array where top-level entries are typically `ServiceNode`s.

Node IDs use a `::` path reflecting nesting depth: leaf nodes are `Platform::Auth::User`, service containers in XYFlow are prefixed `service::Platform::Auth`. Qualified type references in field types (e.g. `Platform::Order`) are supported as single ident tokens.

Edge resolution in `inferEdges`: sibling-first (short name resolved within the same parent service), then qualified global lookup. Unresolved references produce no edge.

### `packages/backend`
Fastify HTTP server that:
- Watches a directory of `.diagram` files via `chokidar`, broadcasting changes over WebSocket
- Exposes REST API for file read/write and layout persistence (`.layout.json` per file)
- Serves the built frontend from `/`
- Configured via `DIAGRAM_DIR` (default: cwd) and `PORT` (default: 3001) env vars

### `packages/frontend`
React 19 + Vite app with a split-pane UI:
- Left pane: Monaco Editor with custom DSL syntax highlighting (`monacoLanguage.ts`)
- Right pane: XYFlow interactive canvas (`DiagramCanvas.tsx`)
- `dslToFlow.ts` converts the parsed AST to XYFlow nodes/edges
- `useFileSync.ts` hook keeps editor and canvas in sync with the backend via WebSocket

**Data flow:** Monaco edit → `parse()` → `dslToFlow()` + `inferEdges()` → XYFlow render. File changes from disk arrive via WebSocket and update the editor content.

## Module System

All packages are ES modules (`"type": "module"`). TypeScript targets ES2022 for backend/parser, ES2020 for frontend. Backend uses `tsx` for development, `tsc` for production builds.
