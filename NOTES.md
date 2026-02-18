# Fryler Research Notes

## Reference Project (`~/Documents/Code/fry`)

### Project Structure

- Bun + TypeScript, ESM-only
- `src/cli.ts` — CLI entrypoint using `parseArgs` from `util` (Node built-in)
- `src/claude.ts` — Claude CLI wrapper
- `src/container.ts` — Apple container management
- `src/session.ts` — Simple file-based session persistence
- `src/auth.ts` — Credential management (host-side dir mounted into containers)
- `src/index.ts` — Public re-exports
- Zero external deps (only `@types/bun` dev dep)

### Container Management Patterns

- Uses `Bun.spawn(["container", ...args])` for all container operations
- `buildRunArgs()` helper constructs CLI flags from a config object
- Start persistent container: `container run --detach --name <name> <image> /bin/sh -c "sleep infinity"`
- Exec in running container: `container exec <name> <command...>`
- Stop: `container stop <name>`
- Remove: `container rm <name>`
- List: `container ls --quiet` (returns IDs one per line)
- Image check: `container image list` (parses table output)
- Build: `container build --tag <tag> --file <path> <context>`
- Interactive TTY: `container run -it` with `spawnSync` + `stdio: "inherit"`
- Auth: mounts `~/.fry/claude-home/` → `/home/fryler/.claude` inside container
- Default image: `fry-claude:latest` built from a Dockerfile (Ubuntu 24.04 + Claude CLI)
- Container naming: `fry-<timestamp_base36>`

### Claude CLI Integration Patterns

- Non-interactive: `claude -p <prompt> --output-format json`
- Resume session: `--resume <session_id>`
- Limit turns: `--max-turns <n>`
- Tool allow-listing: `--allowedTools <tool>`
- JSON response has `session_id`, `result`, `total_cost_usd`, `duration_ms`, `num_turns`
- Response can be array — find the `type === "result"` message
- Uses `Bun.spawn` with `stdout: "pipe"` then `new Response(proc.stdout).text()`

### Session Management

- File-based: saves session ID to `.sessions/<name>.txt`
- Load/save/clear operations
- Named sessions (default: "default")

## Claude CLI Flags (from `claude --help`)

### Critical for Daemon Use

| Flag                            | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `-p, --print`                   | Non-interactive mode — send prompt, get response, exit |
| `--output-format json`          | Single JSON blob with session_id, result, cost, etc.   |
| `--output-format stream-json`   | NDJSON streaming events for real-time token display    |
| `--system-prompt <text>`        | Replace system prompt entirely (only in -p mode)       |
| `--append-system-prompt <text>` | Append to default system prompt                        |
| `--session-id <uuid>`           | Use specific session UUID                              |
| `-r, --resume [id]`             | Resume conversation by session ID                      |
| `-c, --continue`                | Continue most recent conversation                      |
| `--max-turns <n>`               | Limit agentic turns (prevents runaway)                 |
| `--allowedTools <tools>`        | Restrict which tools claude can use                    |
| `--disallowedTools <tools>`     | Block specific tools                                   |
| `--model <model>`               | Choose model (sonnet, opus, or full ID)                |
| `--permission-mode <mode>`      | Control permission behavior                            |
| `--max-budget-usd <amount>`     | Spending cap per invocation                            |
| `--no-session-persistence`      | Don't save session to disk                             |
| `--include-partial-messages`    | Stream partial chunks (with stream-json)               |

### Environment Note

- Claude Code sets `CLAUDE_CODE_ENTRY_POINT` and `CLAUDECODE` env vars
- Must unset these when spawning `claude` from within a Claude Code session
- `env -u CLAUDE_CODE_ENTRY_POINT -u CLAUDECODE claude ...`

## Apple Container CLI (`/usr/local/bin/container`)

### Key Commands

| Command                     | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `container create`          | Create container (doesn't start it)                   |
| `container run`             | Create + start + run command                          |
| `container start <id>`      | Start a created container                             |
| `container stop <id>`       | Stop (SIGTERM, 5s grace, then SIGKILL)                |
| `container delete/rm <id>`  | Remove container                                      |
| `container exec <id> <cmd>` | Run command in running container                      |
| `container inspect <id>`    | Get container info (JSON)                             |
| `container list/ls`         | List containers (`--all`, `--format json`, `--quiet`) |
| `container logs <id>`       | Fetch container logs                                  |
| `container kill <id>`       | Kill/signal container                                 |
| `container image list`      | List local images                                     |
| `container build`           | Build from Dockerfile                                 |

### Container Options

- `--name <name>` — deterministic naming
- `--detach` / `-d` — background mode
- `--rm` — auto-remove on exit
- `-v, --volume <host:container>` — bind mounts
- `-e, --env <KEY=VAL>` — environment variables
- `-w, --workdir <dir>` — working directory
- `-c, --cpus <n>` — CPU allocation
- `-m, --memory <size>` — memory limit (K/M/G/T/P suffix)
- `-p, --publish <host:container>` — port mapping
- `-i, --interactive` — keep stdin open
- `-t, --tty` — allocate TTY
- `--rosetta` — enable Rosetta translation
- `--ssh` — forward SSH agent

### Available Images

- `ubuntu:24.04`
- `fry-claude:latest` (custom — Ubuntu + Claude CLI)

## Design Decisions for Fryler

1. **Container naming**: Use `fryler-runtime` (deterministic, as spec requires)
2. **Image**: Build `fryler:latest` from `ubuntu:24.04` (self-contained — Claude CLI + Bun + fryler source all installed in the Dockerfile)
3. **Claude invocation**: Always use `-p` with `--output-format stream-json` for REPL streaming, `--output-format json` for heartbeat tasks
4. **System prompt**: Use `--system-prompt` to inject SOUL.md content + MEMORY.md context
5. **Session tracking**: SQLite-based (unlike fry's file-based approach)
6. **Process spawning**: `Bun.spawn` with pipe mode, parse streams
7. **Env cleanup**: Must unset `CLAUDECODE`/`CLAUDE_CODE_ENTRY_POINT` when spawning claude
8. **Container-first architecture**: Daemon runs as PID1 inside the container. Host CLI is a thin proxy that manages container lifecycle and forwards commands via `container exec`. The agent can't touch anything outside its sandbox.
9. **Volume mounts**: `~/.fryler/data/` → `/home/fryler/.fryler/` for persistent data, `~/.claude/` → `/home/fryler/.claude/` for auth tokens.
10. **Host/container detection**: `FRYLER_CONTAINER=1` env var (set in Dockerfile) distinguishes modes. Host handles start/stop/status/logs/login locally; everything else proxied.
11. **Identity path resolution**: Inside container, SOUL.md/MEMORY.md resolve from `~/.fryler/` (persistent volume). On host (dev), they resolve from project root. `initIdentityFiles()` copies baked-in defaults on first container run.
12. **First-time bootstrap**: On first `fryler start`, if Claude CLI credentials aren't found in `~/.claude/`, a temporary container is started for interactive login before the daemon boots.
