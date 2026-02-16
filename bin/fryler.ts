#!/usr/bin/env bun

/**
 * Fryler CLI entrypoint.
 *
 * Routing:
 *  - FRYLER_CONTAINER=1 → execute commands directly (inside the container)
 *  - Otherwise → host mode: start/stop/status manage the container,
 *    all other commands are proxied into it via `container exec`
 */

import { parseArgs } from "util";

process.title = "fryler";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h", default: false },
    follow: { type: "boolean", short: "f", default: false },
    new: { type: "boolean", default: false },
    lines: { type: "string", short: "n" },
    session: { type: "string", short: "s" },
    priority: { type: "string", short: "p" },
    scheduled: { type: "string" },
    model: { type: "string", short: "m" },
    "max-turns": { type: "string" },
    verbose: { type: "boolean", short: "v", default: false },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

if (values.help || !command) {
  showHelp();
  process.exit(values.help ? 0 : 1);
}

const isInsideContainer = process.env.FRYLER_CONTAINER === "1";

if (!isInsideContainer) {
  // ─── Host mode ─────────────────────────────────────────────
  // start/stop/status are handled locally on the host.
  // logs reads from the host volume directly (works even when stopped).
  // Everything else is proxied into the container.
  await hostDispatch(command);
} else {
  // ─── Container mode ────────────────────────────────────────
  // All commands execute directly inside the container.
  await containerDispatch(command);
}

// ─── Host-side dispatch ────────────────────────────────────────

async function hostDispatch(cmd: string): Promise<void> {
  const { getConfig } = await import("@/config/index.ts");
  const config = await getConfig();

  switch (cmd) {
    case "start": {
      const { hostStart } = await import("@/proxy/index.ts");
      await hostStart(config);
      break;
    }
    case "stop": {
      const { hostStop } = await import("@/proxy/index.ts");
      await hostStop(config);
      break;
    }
    case "status": {
      const { hostStatus } = await import("@/proxy/index.ts");
      await hostStatus(config);
      break;
    }
    case "restart": {
      const { hostStop, hostStart } = await import("@/proxy/index.ts");
      await hostStop(config);
      await Bun.sleep(1000);
      await hostStart(config);
      break;
    }
    case "rebuild": {
      await hostRebuild(config);
      break;
    }
    case "logs":
      // Read from host volume directly — works even when container is stopped
      await cmdLogs(config.data_dir);
      break;
    case "login": {
      // Login can run without the daemon — spin up a temp container
      const { ensureImage, ensureDataDir, bootstrapLogin } = await import("@/proxy/index.ts");
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");
      const { mkdirSync } = await import("node:fs");

      await ensureImage(config.container_image);
      ensureDataDir(config.data_dir);
      const claudeDir = join(homedir(), ".claude");
      mkdirSync(claudeDir, { recursive: true });
      const volumes = [`${config.data_dir}:/root/.fryler`, `${claudeDir}:/root/.claude`];
      await bootstrapLogin(config, volumes);
      break;
    }
    default: {
      // Proxy everything else into the container
      const { proxyToContainer, isInteractiveCommand } = await import("@/proxy/index.ts");
      const { isContainerRunning } = await import("@/container/manager.ts");

      if (!(await isContainerRunning(config.container_name))) {
        console.error("fryler container is not running. Run 'fryler start' first.");
        process.exit(1);
      }

      const interactive = isInteractiveCommand(cmd);
      const exitCode = await proxyToContainer(
        config.container_name,
        process.argv.slice(2),
        interactive,
      );
      process.exit(exitCode);
    }
  }
}

// ─── Container-side dispatch ───────────────────────────────────

async function containerDispatch(cmd: string): Promise<void> {
  switch (cmd) {
    case "start":
      await cmdStart();
      break;
    case "stop":
      await cmdStop();
      break;
    case "restart":
      await cmdRestart();
      break;
    case "status":
      await cmdStatus();
      break;
    case "ask":
      await cmdAsk(positionals.slice(1));
      break;
    case "chat":
      await cmdChat();
      break;
    case "logs":
      await cmdLogs();
      break;
    case "sessions":
      await cmdSessions();
      break;
    case "resume":
      await cmdResume(positionals[1]);
      break;
    case "task":
      await cmdTask(positionals.slice(1));
      break;
    case "heartbeat":
      await cmdHeartbeat();
      break;
    case "login":
      await cmdLogin();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      showHelp();
      process.exit(1);
  }
}

// ─── Help ──────────────────────────────────────────────────────

function showHelp(): void {
  console.log("fryler — autonomous AI daemon for macOS\n");
  console.log("Usage: fryler <command> [options]\n");
  console.log("Commands:");
  console.log("  start                Start the fryler daemon");
  console.log("  stop                 Stop the fryler daemon");
  console.log("  restart              Restart the fryler daemon");
  console.log("  rebuild              Rebuild the container image from source");
  console.log("  status               Show daemon and container status");
  console.log("  ask <prompt>         One-shot query to Claude");
  console.log("  chat                 Interactive REPL session");
  console.log("  logs [-f] [-n N]     Show daemon logs");
  console.log("  sessions             List conversation sessions");
  console.log("  resume <session-id>  Resume a conversation session");
  console.log("  task add <title>     Create a new task");
  console.log("  task list [status]   List tasks");
  console.log("  task cancel <id>     Cancel a pending task");
  console.log("  heartbeat            Trigger a heartbeat cycle");
  console.log("  login                Authenticate the Claude CLI");
  console.log("\nOptions:");
  console.log("  -h, --help           Show this help");
  console.log("  -s, --session <id>   Session ID for ask/chat");
  console.log("  -m, --model <model>  Claude model override");
  console.log("  --new                Start a fresh session (ask/chat)");
  console.log("  -f, --follow         Follow log output");
  console.log("  -n, --lines <N>      Number of log lines (default: 50)");
  console.log("  -p, --priority <N>   Task priority (1-5, default: 3)");
  console.log("  --scheduled <time>   Schedule task for later (ISO 8601)");
  console.log("  --max-turns <N>      Max Claude turns for ask");
  console.log("  -v, --verbose        Show log output in terminal");
}

// ─── Host-side helpers ──────────────────────────────────────────

async function hostRebuild(config: { container_image: string; container_name: string }): Promise<void> {
  const { join } = await import("node:path");
  const {
    isContainerRunning,
    destroyContainer,
    imageExists,
    removeImage,
    buildImage,
  } = await import("@/container/manager.ts");
  const { getProjectRoot } = await import("@/memory/index.ts");

  // Stop container if running
  if (await isContainerRunning(config.container_name)) {
    console.log("Stopping fryler container...");
    await destroyContainer(config.container_name);
    console.log("Stopped.");
  }

  // Remove old image if it exists
  if (await imageExists(config.container_image)) {
    console.log(`Removing image ${config.container_image}...`);
    await removeImage(config.container_image);
    console.log("Removed.");
  }

  // Rebuild
  const projectRoot = getProjectRoot();
  console.log(`Building ${config.container_image}...`);
  await buildImage(config.container_image, projectRoot, join(projectRoot, "Dockerfile"));
  console.log("Done. Run 'fryler start' to launch.");
}

// ─── Command handlers (container-side) ─────────────────────────

async function cmdStart(): Promise<void> {
  const { startDaemon } = await import("@/daemon/index.ts");
  await startDaemon();
}

async function cmdStop(): Promise<void> {
  const { stopDaemon } = await import("@/daemon/index.ts");
  await stopDaemon();
}

async function cmdRestart(): Promise<void> {
  const { stopDaemon, startDaemon } = await import("@/daemon/index.ts");
  await stopDaemon();
  await Bun.sleep(1000);
  await startDaemon();
}

async function cmdStatus(): Promise<void> {
  const { getDaemonStatus } = await import("@/daemon/index.ts");
  const status = await getDaemonStatus();

  console.log("Daemon:");
  console.log(`  Running: ${status.daemonRunning ? "yes" : "no"}`);
  if (status.pid) {
    console.log(`  PID:     ${status.pid}`);
  }
  console.log("\nContainer:");
  console.log(`  Running: ${status.container.running ? "yes" : "no"}`);
  console.log(`  Name:    ${status.container.name}`);
  if (status.container.uptime) {
    console.log(`  Uptime:  ${status.container.uptime}`);
  }
}

async function cmdAsk(args: string[]): Promise<void> {
  const prompt = args.join(" ");
  if (!prompt) {
    console.error("Usage: fryler ask <prompt>");
    process.exit(1);
  }

  if (!values.verbose) {
    const { logger } = await import("@/logger/index.ts");
    logger.setQuiet(true);
  }

  const { getDb } = await import("@/db/index.ts");
  const { ask } = await import("@/claude/client.ts");
  const { parseClaudeResponse } = await import("@/tasks/parser.ts");
  const { createTask } = await import("@/db/tasks.ts");
  const { createMemory } = await import("@/db/memories.ts");
  const { appendMemory } = await import("@/memory/index.ts");
  const { createSession, updateSession, listSessions } = await import("@/db/sessions.ts");

  getDb();

  const opts: {
    sessionId?: string;
    continueSession?: boolean;
    model?: string;
    maxTurns?: number;
  } = {};
  if (values.model) opts.model = values.model as string;
  if (values["max-turns"]) opts.maxTurns = Number(values["max-turns"]);

  // Session resolution: explicit > auto-resume > new
  let isResuming = false;
  if (values.session) {
    opts.sessionId = values.session as string;
  } else if (!values.new) {
    // Auto-resume: find most recent CLI session
    const sessions = listSessions();
    const cliSession = sessions.find((s) => s.title?.startsWith("[cli] "));
    if (cliSession) {
      opts.continueSession = true;
      isResuming = true;
    }
  }

  const response = await ask(prompt, opts);
  const parsed = parseClaudeResponse(response.result);

  console.log(parsed.cleanText);

  // Track session automatically
  if (response.session_id) {
    if (isResuming || opts.sessionId) {
      updateSession(response.session_id);
    } else {
      createSession(response.session_id, `[cli] ${prompt.slice(0, 80)}`);
    }
  }

  // Silently process markers
  for (const task of parsed.tasks) {
    createTask(task);
  }
  for (const mem of parsed.memories) {
    createMemory(mem.category, mem.content, "cli-ask");
    await appendMemory(mem.content);
  }
}

async function cmdChat(): Promise<void> {
  if (!values.verbose) {
    const { logger } = await import("@/logger/index.ts");
    logger.setQuiet(true);
  }

  const { getDb } = await import("@/db/index.ts");
  const { startRepl } = await import("@/repl/index.ts");
  const { listSessions } = await import("@/db/sessions.ts");

  getDb();

  const opts: { sessionId?: string; autoResume?: boolean } = {};
  if (values.session) {
    opts.sessionId = values.session as string;
  } else if (!values.new) {
    // Auto-resume most recent chat session via --continue
    const sessions = listSessions();
    const chatSession = sessions.find((s) => s.title?.startsWith("[chat] "));
    if (chatSession) {
      opts.autoResume = true;
    }
  }

  await startRepl(opts);
}

async function cmdLogs(dataDir?: string): Promise<void> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");

  // On the host, read from the data volume directory.
  // Inside the container (or dev), read from ~/.fryler/logs/.
  const logDir = dataDir ? join(dataDir, "logs") : join(homedir(), ".fryler", "logs");
  const logFile = join(logDir, "fryler.log");

  if (!existsSync(logFile)) {
    console.log("No log file found. Has the daemon been started?");
    return;
  }

  if (values.follow) {
    const lines = values.lines ? Number(values.lines) : 20;
    const proc = Bun.spawn(["tail", "-n", String(lines), "-f", logFile], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } else {
    const lines = values.lines ? Number(values.lines) : 50;
    const proc = Bun.spawn(["tail", "-n", String(lines), logFile], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  }
}

async function cmdSessions(): Promise<void> {
  const { getDb } = await import("@/db/index.ts");
  const { listSessions } = await import("@/db/sessions.ts");

  getDb();

  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log("Sessions:\n");
  for (const s of sessions) {
    const title = s.title ?? "(untitled)";
    console.log(`  ${s.claude_session_id}`);
    console.log(`    Title:    ${title}`);
    console.log(`    Messages: ${s.message_count}`);
    console.log(`    Last:     ${s.last_active_at}`);
    console.log();
  }
}

async function cmdResume(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error("Usage: fryler resume <session-id>");
    process.exit(1);
  }

  if (!values.verbose) {
    const { logger } = await import("@/logger/index.ts");
    logger.setQuiet(true);
  }

  const { getDb } = await import("@/db/index.ts");
  const { startRepl } = await import("@/repl/index.ts");

  getDb();
  await startRepl({ sessionId });
}

async function cmdTask(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    console.error("Usage: fryler task <add|list|cancel>");
    process.exit(1);
  }

  const { getDb } = await import("@/db/index.ts");
  const { createTask, listTasks, cancelTask } = await import("@/db/tasks.ts");

  getDb();

  switch (subcommand) {
    case "add": {
      const title = args.slice(1).join(" ");
      if (!title) {
        console.error("Usage: fryler task add <title>");
        process.exit(1);
      }
      const priority = values.priority ? Number(values.priority) : 3;
      const scheduled_at = (values.scheduled as string) ?? null;
      const task = createTask({ title, priority, scheduled_at });
      console.log(`Created task #${task.id}: ${task.title} (priority: ${task.priority})`);
      break;
    }
    case "list": {
      const status = args[1] as "pending" | "active" | "completed" | "failed" | undefined;
      const tasks = listTasks(status);
      if (tasks.length === 0) {
        console.log(status ? `No ${status} tasks.` : "No tasks.");
        return;
      }
      console.log("Tasks:\n");
      for (const t of tasks) {
        const sched = t.scheduled_at ? ` (scheduled: ${t.scheduled_at})` : "";
        console.log(`  #${t.id} [${t.status}] ${t.title} (p${t.priority})${sched}`);
        if (t.result) {
          const preview = t.result.length > 100 ? t.result.slice(0, 100) + "..." : t.result;
          console.log(`    Result: ${preview}`);
        }
      }
      console.log();
      break;
    }
    case "cancel": {
      const id = Number(args[1]);
      if (!id || isNaN(id)) {
        console.error("Usage: fryler task cancel <id>");
        process.exit(1);
      }
      const ok = cancelTask(id);
      console.log(ok ? `Cancelled task #${id}.` : `Could not cancel task #${id} (not pending?).`);
      break;
    }
    default:
      console.error(`Unknown task subcommand: ${subcommand}`);
      console.error("Usage: fryler task <add|list|cancel>");
      process.exit(1);
  }
}

async function cmdHeartbeat(): Promise<void> {
  const { getDb } = await import("@/db/index.ts");
  const { triggerHeartbeat } = await import("@/daemon/heartbeat.ts");

  getDb();

  console.log("Triggering heartbeat...");
  await triggerHeartbeat();
  console.log("Heartbeat complete.");
}

async function cmdLogin(): Promise<void> {
  const { buildClaudeEnv } = await import("@/claude/client.ts");

  console.log("Launching claude login...\n");
  const proc = Bun.spawn(["claude", "login"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: buildClaudeEnv(),
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`\nclaude login exited with code ${exitCode}`);
    process.exit(exitCode);
  }
}
