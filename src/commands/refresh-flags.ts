import { spawn } from "node:child_process";
import { loadConfig, resolveProfileName, type ProfileEntry } from "../config.ts";
import { profileDir } from "../paths.ts";
import { pathExists } from "../fs.ts";
import { join } from "node:path";
import { invalidateFlagCache, readFlagSnapshot, type FlagSnapshot } from "../flags.ts";
import * as log from "../logger.ts";
import pc from "picocolors";

export interface RefreshFlagsFlags {
  /** Limit to a single profile (exact or unique prefix). */
  profile?: string;
  /** Invalidate only — clear the cache and let each profile's next launch refetch. */
  lazy?: boolean;
  /** Per-profile timeout for the active refetch boot, in ms. */
  timeoutMs?: number;
  json?: boolean;
}

type Action = "refreshed" | "invalidated" | "skipped" | "failed";

interface ProfileResult {
  name: string;
  action: Action;
  reason?: string;
  before: FlagSnapshot;
  after: FlagSnapshot;
}

const REFRESH_PROMPT = "Reply with the single word: ok";
const DEFAULT_TIMEOUT_MS = 90_000;

export async function runRefreshFlags(flags: RefreshFlagsFlags): Promise<ProfileResult[]> {
  const cfg = await loadConfig();
  const targets: ProfileEntry[] = flags.profile
    ? [resolveProfileName(cfg, flags.profile)]
    : cfg.profiles;

  if (targets.length === 0) {
    log.info("No profiles to refresh.");
    if (flags.json) log.jsonOut([]);
    return [];
  }

  const results: ProfileResult[] = [];
  for (const p of targets) {
    results.push(await refreshOne(p.name, flags));
  }

  if (flags.json) {
    log.jsonOut(results);
    return results;
  }

  report(results, !!flags.lazy);
  return results;
}

async function refreshOne(name: string, flags: RefreshFlagsFlags): Promise<ProfileResult> {
  const dir = profileDir(name);
  const before = await readFlagSnapshot(name);

  if (!(await pathExists(dir))) {
    return { name, action: "skipped", reason: "profile dir missing", before, after: before };
  }

  // Always invalidate first: Claude only refetches when the cache timestamp is
  // absent or stale, so clearing it guarantees the next boot pulls a fresh set.
  const invalidated = await invalidateFlagCache(name);

  if (flags.lazy) {
    const after = await readFlagSnapshot(name);
    return {
      name,
      action: invalidated ? "invalidated" : "skipped",
      reason: invalidated ? "next launch will refetch" : "no cached flags to clear",
      before,
      after,
    };
  }

  // Active mode needs an authenticated profile — a headless boot can't OAuth.
  if (!(await pathExists(join(dir, ".credentials.json")))) {
    return {
      name,
      action: "skipped",
      reason: "needs auth (run the profile once to sign in)",
      before,
      after: await readFlagSnapshot(name),
    };
  }

  log.step(`Refreshing ${name}…`);
  const ok = await headlessBoot(dir, flags.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const after = await readFlagSnapshot(name);

  if (!ok) {
    return { name, action: "failed", reason: "headless boot did not complete", before, after };
  }
  if (after.at === null) {
    return { name, action: "failed", reason: "boot completed but no flags were fetched", before, after };
  }
  return { name, action: "refreshed", before, after };
}

/**
 * Do a minimal non-interactive `claude -p` run in the profile's config dir.
 * The full boot triggers Claude's flag prefetch, which persists to
 * `.claude.json`. The trivial prompt keeps the API turn near-zero cost.
 */
function headlessBoot(dir: string, timeoutMs: number): Promise<boolean> {
  const claudeBin = process.env.CLAUDE_HOPPER_CLAUDE_BIN ?? "claude";
  return new Promise((resolve) => {
    const child = spawn(claudeBin, ["-p", REFRESH_PROMPT], {
      stdio: "ignore",
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function report(results: ProfileResult[], lazy: boolean): void {
  for (const r of results) {
    const icon =
      r.action === "refreshed" || r.action === "invalidated"
        ? pc.green("  ✓")
        : r.action === "skipped"
          ? pc.yellow("  ⚠")
          : pc.red("  ✗");
    const delta =
      r.action === "refreshed"
        ? pc.dim(` — ${r.after.gb} flags, ${r.after.exp} experiments`)
        : r.reason
          ? pc.dim(` — ${r.reason}`)
          : "";
    process.stdout.write(`${icon} ${r.name} ${pc.dim(`(${r.action})`)}${delta}\n`);
  }
  if (lazy) {
    log.info(pc.dim("\nFlags cleared. Each profile refetches on its next launch."));
  }
}
