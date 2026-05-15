# martin-diagram

An interactive service architecture diagram tool. Write a simple DSL in `.diagram` files, get a live visual canvas with typed nodes, inferred connections, and an exportable diagram.

![diagram editor screenshot](docs/screenshot.png)

## Features

- Live-reload canvas — edit the file, diagram updates instantly
- Inferred edges — connections are derived from type references, no manual wiring
- Interactive layout — drag nodes, positions are persisted per-file in a `.layout.json` sidecar
- Monaco editor with syntax highlighting for the DSL
- Export to PNG
- Multi-file sidebar — watch a whole directory of `.diagram` files

## Getting started

### From source

```bash
pnpm install
pnpm dev        # starts backend + frontend in watch mode
```

Then open [http://localhost:5173](http://localhost:5173).

### As a global CLI

```bash
pnpm install:global
martin-diagram [--port <num>] [--dir <path>] [--no-open]
```

| Flag        | Default           | Description                            |
| ----------- | ----------------- | -------------------------------------- |
| `--port`    | `3001`            | Port for the backend server            |
| `--dir`     | current directory | Directory of `.diagram` files to watch |
| `--no-open` | —                 | Don't open the browser automatically   |

## Project structure

```
packages/
  parser/    Pure TS DSL parser — parse(), serialize(), inferEdges()
  backend/   Fastify server, file watcher (chokidar), WebSocket broadcast
  frontend/  React 19 + Vite, Monaco editor, XYFlow canvas
```

## The language

See [language.md](language.md) for the full DSL reference.

## Commands

```bash
pnpm dev      # watch mode (recommended)
pnpm build    # parser → backend → frontend
pnpm start    # production server (requires prior build)
```
