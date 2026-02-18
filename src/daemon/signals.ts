import { logger } from "@/logger/index.ts";

export function registerSignalHandlers(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  function handler(_signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanup().finally(() => {
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error("FATAL: uncaughtException", {
      error: String(err),
      stack: err.stack ?? "no stack",
      ...memorySnapshot(),
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("FATAL: unhandledRejection", {
      reason: String(reason),
      stack: reason instanceof Error ? (reason.stack ?? "no stack") : "n/a",
      ...memorySnapshot(),
    });
    process.exit(1);
  });
}

function memorySnapshot(): Record<string, number> {
  const mem = process.memoryUsage();
  return {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
  };
}
