# fryler

Autonomous AI daemon for macOS. Runs inside an Apple container, executes queued tasks via the Claude CLI, and maintains a persistent memory across sessions.

## Prerequisites

- [Bun](https://bun.sh) v1.2+
- macOS with Apple container support (`/usr/local/bin/container`)
- Base image: `fry-claude:latest` (Ubuntu + Claude CLI — provides `claude` inside the container)

## Install

```bash
bun install
bun link   # makes `fryler` available globally
```

## Quick Start

```bash
# Start the daemon (builds image on first run, prompts for Claude login if needed)
fryler start

# Ask a question (sessions auto-tracked)
fryler ask "What's the capital of France?"
fryler ask "And what about Germany?"  # continues same session

# Interactive chat
fryler chat

# Check status
fryler status

# Stop
fryler stop
```

## Commands

| Command                      | Description                               |
| ---------------------------- | ----------------------------------------- |
| `fryler start`               | Build image (if needed), start container  |
| `fryler stop`                | Stop and remove the container             |
| `fryler restart`             | Stop + start                              |
| `fryler rebuild`             | Rebuild container image from source       |
| `fryler status`              | Show container and daemon status          |
| `fryler ask <prompt>`        | One-shot query to Claude                  |
| `fryler chat`                | Interactive REPL with streaming           |
| `fryler resume <session-id>` | Resume a specific session in the REPL     |
| `fryler sessions`            | List conversation sessions                |
| `fryler task add <title>`    | Create a task                             |
| `fryler task list [status]`  | List tasks (optionally filter by status)  |
| `fryler task cancel <id>`    | Cancel a pending task                     |
| `fryler heartbeat`           | Manually trigger a heartbeat cycle        |
| `fryler logs [-f] [-n N]`    | View daemon logs (reads from host volume) |
| `fryler login`               | Authenticate the Claude CLI in container  |

### Options

```
-h, --help           Show help
-s, --session <id>   Explicit session ID for ask/chat
-m, --model <model>  Claude model override
--new                Start a fresh session (ask/chat)
--max-turns <N>      Max Claude turns for ask
-p, --priority <N>   Task priority (1-5, default: 3)
--scheduled <time>   Schedule task for later (ISO 8601)
-f, --follow         Follow log output (tail -f)
-n, --lines <N>      Number of log lines to show
-v, --verbose        Show log output in terminal
```

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

```
bin/fryler.ts              CLI entrypoint (host/container routing)
src/
  proxy/index.ts           Host-side proxy (container lifecycle, exec forwarding)
  claude/client.ts         Claude CLI wrapper (ask, streaming, env sanitization)
  config/index.ts          TOML config loader (~/.fryler/config.toml)
  container/manager.ts     Apple container lifecycle (start, exec, stop, build)
  daemon/
    index.ts               Daemon lifecycle (start, stop, status)
    heartbeat.ts           Heartbeat loop (process due tasks)
    pid.ts                 PID file management
    signals.ts             SIGTERM/SIGINT handlers
  db/
    index.ts               SQLite init (WAL mode)
    tasks.ts               Task CRUD
    memories.ts            Memory CRUD
    sessions.ts            Session tracking
  logger/index.ts          Structured logging with daily rotation
  memory/index.ts          SOUL.md / MEMORY.md (container-aware path resolution)
  repl/index.ts            Interactive REPL with streaming
  tasks/parser.ts          FRYLER_TASK / FRYLER_MEMORY marker extraction
Dockerfile                 Container image definition
```

### How It Works

1. **Host CLI** checks `FRYLER_CONTAINER` env var to determine if it's running on the host or inside the container
2. **On first start**, builds the container image from the Dockerfile and prompts for Claude CLI authentication if needed
3. **`fryler start`** on the host runs `container run --detach` with volume mounts, starting the daemon as PID1 inside the container
4. **Daemon** acquires a PID lock, initializes identity files, SQLite DB, and starts the heartbeat loop
5. **Heartbeat** checks for due tasks every N seconds, sends each to Claude via the CLI, parses the response for task/memory markers
6. **Claude CLI** is invoked via `Bun.spawn` with identity context (SOUL.md + MEMORY.md) injected as the system prompt
7. **Sessions** are tracked automatically — sequential `fryler ask` calls continue the same conversation
8. **Interactive commands** (`chat`, `resume`, `login`) are proxied with TTY passthrough via `container exec -it`
9. **`fryler logs`** reads from the host volume directly, working even when the container is stopped

### Identity Files

- **SOUL.md** — Read-only personality and behavior instructions. Fryler never modifies this.
- **MEMORY.md** — Append-only knowledge. Fryler adds entries as it learns things about you.

On first container run, these are copied from baked-in defaults (`/opt/fryler/`) to the persistent volume (`/root/.fryler/`).

### Configuration

Create `~/.fryler/config.toml`:

```toml
heartbeat_interval_seconds = 60
log_level = "info"
container_image = "fryler:latest"  # built automatically from Dockerfile
container_name = "fryler-runtime"
claude_model = "sonnet"
claude_max_turns = 25
```

All values have sensible defaults.

## Development

```bash
bun test              # 134 tests
bun run lint          # oxlint
bun run fmt           # oxfmt
bun run dev           # watch mode
```

## Data

Host-side layout:

```
~/.fryler/
  config.toml           User configuration
  data/                 Volume mounted into container
    fryler.pid          Daemon PID file
    fryler.db           SQLite database (tasks, memories, sessions)
    SOUL.md             Identity (read-only)
    MEMORY.md           Identity (append-only)
    logs/
      fryler.log        Current log file
      fryler-YYYY-MM-DD.log  Rotated logs

~/.claude/              Claude CLI credentials (volume mounted into container)
```
