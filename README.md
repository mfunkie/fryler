# fryler

Autonomous AI daemon for macOS. Runs as a background process, executes queued tasks via the Claude CLI, and maintains a persistent memory across sessions.

## Prerequisites

- [Bun](https://bun.sh) v1.2+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) installed and authenticated
- macOS with Apple container support (`/usr/local/bin/container`)

## Install

```bash
bun install
bun link   # makes `fryler` available globally
```

## Quick Start

```bash
# Authenticate Claude (first time)
fryler login

# Start the daemon
fryler start

# Ask a question (sessions auto-tracked)
fryler ask "What's the capital of France?"
fryler ask "And what about Germany?"  # continues same session

# Interactive chat
fryler chat

# Check status
fryler status
```

## Commands

| Command                      | Description                              |
| ---------------------------- | ---------------------------------------- |
| `fryler start`               | Start the daemon (foreground)            |
| `fryler stop`                | Stop the daemon                          |
| `fryler restart`             | Stop + start                             |
| `fryler status`              | Show daemon and container status         |
| `fryler ask <prompt>`        | One-shot query to Claude                 |
| `fryler chat`                | Interactive REPL with streaming          |
| `fryler resume <session-id>` | Resume a specific session in the REPL    |
| `fryler sessions`            | List conversation sessions               |
| `fryler task add <title>`    | Create a task                            |
| `fryler task list [status]`  | List tasks (optionally filter by status) |
| `fryler task cancel <id>`    | Cancel a pending task                    |
| `fryler heartbeat`           | Manually trigger a heartbeat cycle       |
| `fryler logs [-f] [-n N]`    | View daemon logs                         |
| `fryler login`               | Authenticate the Claude CLI              |

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
```

## Architecture

```
bin/fryler.ts              CLI entrypoint (parseArgs dispatch)
src/
  claude/client.ts         Claude CLI wrapper (ask, streaming, env sanitization)
  config/index.ts          TOML config loader (~/.fryler/config.toml)
  container/manager.ts     Apple container lifecycle (start, exec, stop)
  daemon/
    index.ts               Daemon lifecycle (start, stop, status)
    heartbeat.ts           Heartbeat loop (process due tasks)
    pid.ts                 PID file management (~/.fryler/fryler.pid)
    signals.ts             SIGTERM/SIGINT handlers
  db/
    index.ts               SQLite init (WAL mode)
    tasks.ts               Task CRUD
    memories.ts            Memory CRUD
    sessions.ts            Session tracking
  logger/index.ts          Structured logging with daily rotation
  memory/index.ts          SOUL.md / MEMORY.md file management
  repl/index.ts            Interactive REPL with streaming
  tasks/parser.ts          FRYLER_TASK / FRYLER_MEMORY marker extraction
```

### How It Works

1. **Daemon** acquires a PID lock, starts an Apple container, initializes SQLite, and runs a heartbeat loop
2. **Heartbeat** checks for due tasks every N seconds, sends each to Claude via the CLI, parses the response for task/memory markers
3. **Claude CLI** is invoked via `Bun.spawn` with identity context (SOUL.md + MEMORY.md) injected as the system prompt
4. **Sessions** are tracked automatically — sequential `fryler ask` calls continue the same conversation
5. **FRYLER_TASK** and **FRYLER_MEMORY** markers in Claude's responses are silently extracted, persisted, and stripped from output

### Identity Files

- **SOUL.md** — Read-only personality and behavior instructions. Fryler never modifies this.
- **MEMORY.md** — Append-only knowledge. Fryler adds entries as it learns things about you.

### Configuration

Create `~/.fryler/config.toml`:

```toml
heartbeat_interval_seconds = 60
log_level = "info"
container_image = "fry-claude:latest"
container_name = "fryler-runtime"
claude_model = "sonnet"
claude_max_turns = 25
```

All values have sensible defaults.

## Development

```bash
bun test              # 131 tests
bun run lint          # oxlint
bun run fmt           # oxfmt
bun run dev           # watch mode
```

## Data

All runtime data lives in `~/.fryler/`:

```
~/.fryler/
  fryler.pid            Daemon PID file
  fryler.db             SQLite database (tasks, memories, sessions)
  config.toml           User configuration
  logs/
    fryler.log          Current log file
    fryler-YYYY-MM-DD.log  Rotated logs
```
