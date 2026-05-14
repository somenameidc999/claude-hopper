import { canonicalClaudeDir, profileDir, profilesDir } from "./paths.ts";
import {
  copyTree,
  ensureDir,
  pathExists,
  removePath,
} from "./fs.ts";
import { HopperError } from "./errors.ts";
import type { SeedSource } from "./config.ts";

/**
 * Paths under a Claude Code config dir that must NEVER be copied or synced.
 * These are auth secrets and per-machine state.
 */
export const EXCLUDED_PREFIXES = [
  "projects",
  "todos",
  "session-env",
  "statsig",
  "locks",
  "cache",
  "shell-snapshots",
  "plugins/marketplaces",
  "plugins/installed",
  "paste-cache",
];

export const EXCLUDED_BASENAMES = [
  ".credentials.json",
  ".claude.json",
  "known_marketplaces.json",
  "settings.local.json",
];

export async function ensureProfilesRoot(): Promise<void> {
  await ensureDir(profilesDir());
}

/**
 * Materialize a profile directory from the given seed. Caller is responsible
 * for updating config.json and shell aliases.
 */
export async function seedProfile(
  name: string,
  seed: SeedSource,
): Promise<void> {
  const dst = profileDir(name);
  await ensureDir(dst);
  if (seed === "empty") return;
  if (seed === "canonical") {
    const src = canonicalClaudeDir();
    if (!(await pathExists(src))) {
      throw new HopperError(
        `Cannot seed from ~/.claude — directory does not exist.`,
        "Run `claude` once to create it, or choose a different seed (`--seed empty`).",
        "SEED_CANONICAL_MISSING",
      );
    }
    await copyTree(src, dst, {
      excludePrefixes: EXCLUDED_PREFIXES,
      excludeBasenames: EXCLUDED_BASENAMES,
    });
    return;
  }
  if (seed.startsWith("clone:")) {
    const sourceName = seed.slice("clone:".length);
    const src = profileDir(sourceName);
    if (!(await pathExists(src))) {
      throw new HopperError(
        `Cannot clone from profile "${sourceName}" — directory does not exist.`,
        "Run `claude-hopper profile list` to see available profiles.",
        "SEED_CLONE_MISSING",
      );
    }
    await copyTree(src, dst, {
      excludePrefixes: EXCLUDED_PREFIXES,
      excludeBasenames: EXCLUDED_BASENAMES,
    });
    return;
  }
  throw new HopperError(
    `Unknown seed source "${seed}".`,
    "Use --seed canonical, --seed empty, or --seed clone:<name>.",
    "SEED_UNKNOWN",
  );
}

export async function removeProfileDir(name: string): Promise<void> {
  await removePath(profileDir(name));
}

export async function profileDirExists(name: string): Promise<boolean> {
  return pathExists(profileDir(name));
}
