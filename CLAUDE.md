# CLAUDE.md

## Project Overview

Fryler is an autonomous AI daemon for macOS. It runs as a background process, executes queued tasks via the Claude CLI, and maintains persistent memory across sessions.

**Tech stack:** Bun, TypeScript (strict, ESM), bun:sqlite, bun:test, oxlint, oxfmt

## Code Conventions

- Always use `function` statements at module scope. Never `const fn = () => {}`.
- Path alias `@/*` maps to `./src/*` (configured in tsconfig.json).
- All imports use `.ts` extensions (Bun convention).
- No external runtime dependencies — only Bun built-ins and Node.js APIs.
- Dev dependencies: `oxlint` (linting), `oxfmt` (formatting), `@types/bun`, `typescript`.

## Architecture

```
bin/fryler.ts           CLI entrypoint — parseArgs dispatch to command handlers
src/claude/client.ts    Claude CLI wrapper — spawns `claude` with env sanitization
src/config/index.ts     TOML config from ~/.fryler/config.toml
src/container/manager.ts Apple container lifecycle via /usr/local/bin/container
src/daemon/             Daemon lifecycle, heartbeat loop, PID, signals
src/db/                 SQLite (WAL mode) — tasks, memories, sessions tables
src/logger/index.ts     Structured logging with daily rotation
src/memory/index.ts     SOUL.md (read-only) and MEMORY.md (append-only) management
src/repl/index.ts       Interactive REPL with streaming and session tracking
src/tasks/parser.ts     FRYLER_TASK / FRYLER_MEMORY marker extraction from responses
```

## Key Patterns

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

- `bun test` — 131 tests across 9 test files.
- Tests use isolated temp SQLite DBs via `_setDbPath()`.
- Avoid `mock.module()` — it pollutes the global module cache across test files in Bun. Use dependency injection or test only the DB/lifecycle layer directly.

## Commands

```bash
bun test          # run tests
bun run lint      # oxlint src/ bin/
bun run fmt       # oxfmt --write .
bun run dev       # watch mode
```

## File Locations

- Runtime data: `~/.fryler/` (PID, DB, config, logs)
- Identity: `SOUL.md` (project root, read-only), `MEMORY.md` (project root, append-only)
- Database: `~/.fryler/fryler.db` (SQLite WAL mode)
