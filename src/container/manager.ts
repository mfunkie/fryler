/**
 * Apple container lifecycle management.
 * Wraps the `container` CLI for start/stop/exec/status operations.
 *
 * Requires: macOS 26+ on Apple Silicon, with `container` CLI installed.
 * Install via: https://github.com/apple/container/releases
 * Start daemon: container system start
 */

import { logger } from "../logger/index.ts";

export interface ContainerConfig {
  image: string;
  name: string;
  volumes?: string[];
  env?: Record<string, string>;
  workdir?: string;
  cpus?: number;
  memory?: string;
  command?: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerStatus {
  running: boolean;
  name: string;
  uptime?: string;
}

/**
 * Check whether the `container` CLI is available on this system.
 */
async function isContainerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["container", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a container image exists locally.
 */
async function imageExists(image: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["container", "image", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return false;

    const parts = image.includes(":") ? image.split(":") : [image, ""];
    const name = parts[0]!;
    const tag = parts[1] ?? "";
    return stdout.split("\n").some((line) => {
      if (!line.includes(name)) return false;
      return tag ? line.includes(tag) : true;
    });
  } catch {
    return false;
  }
}

/**
 * Build argument list for container run/create from config.
 */
function buildRunArgs(config: ContainerConfig): string[] {
  const args: string[] = [];

  args.push("--name", config.name);

  if (config.workdir) {
    args.push("--workdir", config.workdir);
  }

  if (config.cpus) {
    args.push("--cpus", String(config.cpus));
  }

  if (config.memory) {
    args.push("--memory", config.memory);
  }

  if (config.volumes?.length) {
    for (const vol of config.volumes) {
      args.push("--volume", vol);
    }
  }

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  args.push(config.image);
  return args;
}

/**
 * Start a container in the background.
 * If config.command is provided, it is used as the entrypoint args.
 * Otherwise falls back to `sleep infinity` to keep it alive for exec commands.
 */
async function startContainer(config: ContainerConfig): Promise<void> {
  if (!(await isContainerAvailable())) {
    throw new Error(
      "Apple container CLI not found. Install from https://github.com/apple/container/releases",
    );
  }

  // Check if already running
  if (await isContainerRunning(config.name)) {
    logger.info("Container already running", { name: config.name });
    return;
  }

  // Remove any stopped container with the same name
  await removeContainer(config.name).catch(() => {});

  const args = buildRunArgs(config);
  const cmd = config.command ?? ["/bin/sh", "-c", "sleep infinity"];
  args.push(...cmd);

  logger.info("Starting container", { name: config.name, image: config.image });

  const proc = Bun.spawn(["container", "run", "--detach", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Failed to start container ${config.name}: ${stderr}`);
  }

  logger.info("Container started", { name: config.name });
}

/**
 * Execute a command inside a running container.
 */
async function execInContainer(name: string, command: string[]): Promise<ExecResult> {
  const proc = Bun.spawn(["container", "exec", name, ...command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Execute a command in the container with streaming stdout.
 * Returns the process for the caller to consume the stream.
 */
function execInContainerStreaming(name: string, command: string[]): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["container", "exec", name, ...command], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

/**
 * Stop a running container.
 */
async function stopContainer(name: string): Promise<void> {
  logger.info("Stopping container", { name });

  const proc = Bun.spawn(["container", "stop", name], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.warn("Failed to stop container", { name, stderr: stderr.trim() });
  } else {
    logger.info("Container stopped", { name });
  }
}

/**
 * Remove a stopped container.
 */
async function removeContainer(name: string): Promise<void> {
  const proc = Bun.spawn(["container", "rm", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}

/**
 * Check whether a specific container is currently running.
 */
async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["container", "ls", "--quiet"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return false;

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .some((id) => id === name);
  } catch {
    return false;
  }
}

/**
 * Get the status of the fryler container.
 */
async function getContainerStatus(name: string): Promise<ContainerStatus> {
  const running = await isContainerRunning(name);

  if (!running) {
    return { running: false, name };
  }

  // Get detailed info
  try {
    const proc = Bun.spawn(["container", "inspect", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const info = JSON.parse(stdout);
      const startedDate = info?.startedDate ? new Date(info.startedDate * 1000) : null;
      const uptime = startedDate ? formatUptime(Date.now() - startedDate.getTime()) : undefined;

      return { running: true, name, uptime };
    }
  } catch {
    // Fall through to basic status
  }

  return { running: true, name };
}

/**
 * Build a container image from a Dockerfile.
 */
async function buildImage(tag: string, contextDir: string, dockerfile?: string): Promise<void> {
  const args = ["container", "build", "--tag", tag];
  if (dockerfile) {
    args.push("--file", dockerfile);
  }
  args.push(contextDir);

  logger.info("Building container image", { tag, contextDir });

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Failed to build image ${tag}: ${stderr}`);
  }

  logger.info("Image built", { tag });
}

/**
 * Stop and remove the container. Graceful shutdown.
 */
async function destroyContainer(name: string): Promise<void> {
  await stopContainer(name);
  await removeContainer(name);
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export {
  isContainerAvailable,
  imageExists,
  buildImage,
  startContainer,
  execInContainer,
  execInContainerStreaming,
  stopContainer,
  removeContainer,
  isContainerRunning,
  getContainerStatus,
  destroyContainer,
};
