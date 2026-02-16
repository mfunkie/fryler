#!/usr/bin/env bun

/**
 * Fryler CLI entrypoint.
 * Parses arguments and dispatches to the appropriate command handler.
 */

// Set process name for easy identification (pkill fryler, ps aux | grep fryler)
process.title = "fryler";

const args = process.argv.slice(2);
const command = args[0];

// TODO: Implement command dispatching in Phase 6
console.log(`fryler: command="${command ?? "(none)"}", args=${JSON.stringify(args)}`);
console.log("fryler is not yet implemented. Coming soon.");
