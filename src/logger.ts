import pc from "picocolors";

let jsonMode = false;

// Allow callers (tests) to fully silence stderr output.
const quiet = process.env.CLAUDE_HOPPER_QUIET === "1";

export function setJsonMode(on: boolean) {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

function shouldSkip(): boolean {
  return jsonMode || quiet;
}

export function info(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(msg + "\n");
}

export function success(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(pc.green("✓ ") + msg + "\n");
}

export function warn(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(pc.yellow("⚠ ") + msg + "\n");
}

export function err(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(pc.red("✗ ") + msg + "\n");
}

export function step(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(pc.cyan("→ ") + msg + "\n");
}

export function dim(msg: string) {
  if (shouldSkip()) return;
  process.stderr.write(pc.dim(msg) + "\n");
}

export function out(msg: string) {
  if (shouldSkip()) return;
  process.stdout.write(msg + "\n");
}

export function jsonOut(value: unknown) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }
}

export const c = pc;
