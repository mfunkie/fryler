# CLAUDE.md

## Project Overview

Fryler is an autonomous AI daemon for macOS. It runs inside an Apple container, executes queued tasks via the Claude CLI, and maintains persistent memory across sessions. The host CLI is a thin proxy that manages the container lifecycle and forwards commands into it.

**Tech stack:** Bun, TypeScript (strict, ESM), bun:sqlite, bun:test, oxlint, oxfmt

## Code Conventions

- Always use `function` statements at module scope. Never `const fn = () => {}`.
- Path alias `@/*` maps to `./src/*` (configured in tsconfig.json).
- All imports use `.ts` extensions (Bun convention).
- No external runtime dependencies — only Bun built-ins and Node.js APIs.
- Dev dependencies: `oxlint` (linting), `oxfmt` (formatting), `@types/bun`, `typescript`.

## Architecture

```
HOST (bin/fryler.ts — thin proxy)          CONTAINER (fryler-runtime)
┌─────────────────────────────┐            ┌──────────────────────────────┐
│ fryler start → container run│───────────>│ PID1: fryler start (daemon)  │
│ fryler stop  → container stop            │   - heartbeat loop           │
│ fryler chat  → container exec -it        │   - SQLite DB                │
│ fryler ask   → container exec            │   - SOUL.md / MEMORY.md      │
│ fryler *     → container exec            │   - Claude CLI sessions      │
│                             │            │   - Logs                     │
│ ~/.fryler/config.toml       │            │                              │
│ ~/.fryler/data/ ──(volume)──│───────────>│ /root/.fryler/               │
│ ~/.claude/    ──(volume)────│───────────>│ /root/.claude/               │
└─────────────────────────────┘            └──────────────────────────────┘
```

### Key Files

```
bin/fryler.ts              CLI entrypoint — host/container routing via FRYLER_CONTAINER env
src/proxy/index.ts         Host-side proxy — container lifecycle, exec forwarding, bootstrap
src/claude/client.ts       Claude CLI wrapper — spawns `claude` with env sanitization
src/config/index.ts        TOML config from ~/.fryler/config.toml
src/container/manager.ts   Apple container lifecycle (start, exec, stop, build)
src/daemon/                Daemon lifecycle, heartbeat loop, PID, signals
src/db/                    SQLite (WAL mode) — tasks, memories, sessions tables
src/logger/index.ts        Structured logging with daily rotation
src/memory/index.ts        SOUL.md / MEMORY.md — container-aware path resolution
src/repl/index.ts          Interactive REPL with streaming and session tracking
src/tasks/parser.ts        FRYLER_TASK / FRYLER_MEMORY marker extraction from responses
Dockerfile                 Container image: fry-claude + Bun + fryler source
```

## Key Patterns

### Container-First Architecture

The daemon runs inside an Apple container. The host CLI (`bin/fryler.ts`) checks `FRYLER_CONTAINER` env var:

- **Host mode** (default): `start`/`stop`/`status`/`restart`/`rebuild`/`logs`/`login` are handled locally. All other commands proxy into the container via `container exec`.
- **Container mode** (`FRYLER_CONTAINER=1`): All commands execute directly.

Volume mounts persist data across container restarts:

- `~/.fryler/data/` → `/root/.fryler/` (DB, identity files, logs)
- `~/.claude/` → `/root/.claude/` (Claude CLI auth tokens)

### First-Time Bootstrap

On first `fryler start`, if Claude CLI credentials aren't found in `~/.claude/`, the proxy spins up a temporary container and runs `fryler login` interactively before starting the daemon.

### Claude CLI Invocation

All AI work goes through `Bun.spawn(["claude", ...args])`. The `buildClaudeEnv()` function strips `CLAUDECODE` and `CLAUDE_CODE_ENTRY_POINT` from the environment to prevent nesting detection. Identity context (SOUL.md + MEMORY.md) is injected via `--system-prompt`.

### Session Management

Sessions auto-track: `fryler ask` tags sessions as `[cli]`, `fryler chat` tags as `[chat]`. The most recent matching session is resumed automatically unless `--new` is passed.

### Marker System

Claude responses can contain HTML comment markers that the parser extracts:

- `<!-- FRYLER_TASK: {"title": "...", "description": "...", "priority": N, "scheduled_at": "..."} -->`
- `<!-- FRYLER_MEMORY: {"category": "...", "content": "..."} -->`

These are stripped from display output and persisted to SQLite / MEMORY.md.

### Testing

- `bun test` — 134 tests across 9 test files.
- Tests use isolated temp SQLite DBs via `_setDbPath()`.
- Avoid `mock.module()` — it pollutes the global module cache across test files in Bun. Use dependency injection or test only the DB/lifecycle layer directly.

## Commands

```bash
bun test          # run tests
bun run lint      # oxlint .
bun run fmt       # oxfmt --write .
bun run dev       # watch mode
```

## File Locations

- Host config: `~/.fryler/config.toml`
- Host data volume: `~/.fryler/data/` (mounted into container as `/root/.fryler/`)
- Container identity: `/root/.fryler/SOUL.md`, `/root/.fryler/MEMORY.md`
- Container database: `/root/.fryler/fryler.db` (SQLite WAL mode)
- Claude auth: `~/.claude/` (mounted into container as `/root/.claude/`)
