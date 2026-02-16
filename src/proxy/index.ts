/**
 * Host-side proxy for container-first architecture.
 *
 * When fryler runs on the host (not inside a container), this module
 * handles container lifecycle (start/stop/status) and proxies all other
 * commands into the running container via `container exec`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  isContainerAvailable,
  imageExists,
  buildImage,
  startContainer,
  isContainerRunning,
  getContainerStatus,
  destroyContainer,
} from "../container/manager.ts";
import { getProjectRoot } from "../memory/index.ts";
import type { FrylerConfig } from "../config/index.ts";

/** Commands that need TTY passthrough (stdin: "inherit"). */
const INTERACTIVE_COMMANDS = new Set(["chat", "resume", "login"]);

/**
 * Proxy a CLI invocation into the running container.
 * Interactive commands get full TTY passthrough.
 */
async function proxyToContainer(
  containerName: string,
  args: string[],
  interactive: boolean,
): Promise<number> {
  const execArgs = ["container", "exec"];

  if (interactive) {
    execArgs.push("-it");
  }

  execArgs.push(containerName, "fryler", ...args);

  const proc = Bun.spawn(execArgs, {
    stdin: interactive ? "inherit" : "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

/**
 * Ensure the fryler container image is built. Builds if missing.
 */
async function ensureImage(imageName: string): Promise<void> {
  if (await imageExists(imageName)) {
    return;
  }

  console.log(`Building container image ${imageName}...`);
  const projectRoot = getProjectRoot();
  await buildImage(imageName, projectRoot, join(projectRoot, "Dockerfile"));
  console.log("Image built.");
}

/**
 * Ensure the data directory exists on the host for volume mounting.
 */
function ensureDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
}

/**
 * Check if Claude CLI credentials exist on the host.
 * Looks for ~/.claude/ directory with credential files.
 */
function isClaudeAuthenticated(): boolean {
  const claudeDir = join(homedir(), ".claude");
  // Claude stores credentials in ~/.claude/. If the directory doesn't exist
  // or is empty, the user hasn't authenticated yet.
  if (!existsSync(claudeDir)) return false;
  // Check for common credential indicators
  return (
    existsSync(join(claudeDir, "credentials.json")) ||
    existsSync(join(claudeDir, ".credentials.json"))
  );
}

/**
 * Bootstrap Claude authentication inside a temporary container.
 * Starts the container, runs `fryler login` interactively, then stops it.
 */
async function bootstrapLogin(config: FrylerConfig, volumes: string[]): Promise<void> {
  console.log("\nClaude CLI is not authenticated. Starting first-time setup...\n");

  // Start a temporary container for login
  const tempName = `${config.container_name}-setup`;
  await startContainer({
    image: config.container_image,
    name: tempName,
    volumes,
    command: ["/bin/sh", "-c", "sleep infinity"],
  });

  let loginFailed = false;
  try {
    // Run interactive login inside the temp container
    const proc = Bun.spawn(["container", "exec", "-it", tempName, "fryler", "login"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      loginFailed = true;
    } else {
      console.log("\nAuthentication complete.");
    }
  } finally {
    // Clean up temp container
    await destroyContainer(tempName);
  }

  if (loginFailed) {
    console.error("\nLogin failed. Run 'fryler login' to try again.");
    process.exit(1);
  }
}

/**
 * Handle `fryler start` on the host — build image, start container with volumes.
 * On first run, bootstraps Claude CLI authentication.
 */
async function hostStart(config: FrylerConfig): Promise<void> {
  if (!(await isContainerAvailable())) {
    console.error(
      "Apple container CLI not found. Install from https://github.com/apple/container/releases",
    );
    process.exit(1);
  }

  if (await isContainerRunning(config.container_name)) {
    console.log("fryler container is already running.");
    return;
  }

  await ensureImage(config.container_image);
  ensureDataDir(config.data_dir);

  const claudeDir = join(homedir(), ".claude");
  mkdirSync(claudeDir, { recursive: true });

  const volumes = [`${config.data_dir}:/root/.fryler`, `${claudeDir}:/root/.claude`];

  // First-time bootstrap: authenticate Claude inside the container
  if (!isClaudeAuthenticated()) {
    await bootstrapLogin(config, volumes);
  }

  console.log("Starting fryler container...");
  await startContainer({
    image: config.container_image,
    name: config.container_name,
    volumes,
    command: ["fryler", "start"],
  });
  console.log("fryler is running.");
}

/**
 * Handle `fryler stop` on the host — stop and remove the container.
 */
async function hostStop(config: FrylerConfig): Promise<void> {
  if (!(await isContainerRunning(config.container_name))) {
    console.log("fryler container is not running.");
    return;
  }

  console.log("Stopping fryler container...");
  await destroyContainer(config.container_name);
  console.log("fryler stopped.");
}

/**
 * Handle `fryler status` on the host — show container + daemon info.
 */
async function hostStatus(config: FrylerConfig): Promise<void> {
  const container = await getContainerStatus(config.container_name);

  console.log("Container:");
  console.log(`  Running: ${container.running ? "yes" : "no"}`);
  console.log(`  Name:    ${container.name}`);
  if (container.uptime) {
    console.log(`  Uptime:  ${container.uptime}`);
  }

  if (container.running) {
    // Get daemon status from inside the container
    console.log("\nDaemon:");
    const exitCode = await proxyToContainer(config.container_name, ["status"], false);
    if (exitCode !== 0) {
      console.log("  (could not query daemon status)");
    }
  }
}

/**
 * Determine if a command is interactive (needs TTY).
 */
function isInteractiveCommand(command: string): boolean {
  return INTERACTIVE_COMMANDS.has(command);
}

export {
  proxyToContainer,
  ensureImage,
  ensureDataDir,
  isClaudeAuthenticated,
  bootstrapLogin,
  hostStart,
  hostStop,
  hostStatus,
  isInteractiveCommand,
};
