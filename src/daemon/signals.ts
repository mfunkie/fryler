function registerSignalHandlers(cleanup: () => Promise<void>): void {
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
}

export { registerSignalHandlers };
