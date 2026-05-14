import { configPath, hopperDir, tildify, untildify } from "./paths.ts";
import { ensureDir, pathExists, readJson, writeJsonAtomic } from "./fs.ts";
import { HopperError } from "./errors.ts";

export type SeedSource = "canonical" | "empty" | `clone:${string}`;

export interface ProfileEntry {
  name: string;
  createdAt: string;
  seedSource: SeedSource;
  shell: {
    alias: string;
  };
}

export interface HopperConfig {
  version: 1;
  profiles: ProfileEntry[];
  shell: {
    /** Tildified path, e.g. `~/.zshrc`. May be empty if shell setup is skipped. */
    rcFile: string;
  };
  sync: {
    enabled: boolean;
    remote: string;
    branch: string;
  };
}

export function defaultConfig(): HopperConfig {
  return {
    version: 1,
    profiles: [],
    shell: { rcFile: "" },
    sync: { enabled: false, remote: "origin", branch: "main" },
  };
}

export async function loadConfig(): Promise<HopperConfig> {
  const p = configPath();
  if (!(await pathExists(p))) {
    throw new HopperError(
      "claude-hopper is not initialized on this machine.",
      "Run `claude-hopper init` to set it up.",
      "NOT_INITIALIZED",
    );
  }
  let raw: unknown;
  try {
    raw = await readJson(p);
  } catch (e) {
    throw new HopperError(
      `Failed to parse config at ${tildify(p)}: ${(e as Error).message}`,
      "Fix the JSON syntax or restore from a previous version via `git checkout config.json` inside ~/.claude-hopper.",
      "CONFIG_PARSE",
    );
  }
  return migrateConfig(raw);
}

export async function saveConfig(cfg: HopperConfig): Promise<void> {
  await ensureDir(hopperDir());
  assertNoAbsolutePaths(cfg);
  await writeJsonAtomic(configPath(), cfg);
}

export async function loadConfigOrDefault(): Promise<HopperConfig> {
  if (!(await pathExists(configPath()))) return defaultConfig();
  return loadConfig();
}

function migrateConfig(raw: unknown): HopperConfig {
  if (!raw || typeof raw !== "object") {
    throw new HopperError(
      "Config root is not an object.",
      "Restore config.json from a previous commit or delete it and run `claude-hopper init` again.",
      "CONFIG_SHAPE",
    );
  }
  const r = raw as Partial<HopperConfig>;
  const version = r.version ?? 1;
  if (version !== 1) {
    throw new HopperError(
      `Config version ${version} is newer than this version of claude-hopper understands.`,
      "Update claude-hopper: `npm install -g claude-hopper@latest`.",
      "CONFIG_VERSION",
    );
  }
  const out: HopperConfig = {
    version: 1,
    profiles: (r.profiles ?? []).map((p) => ({
      name: p.name,
      createdAt: p.createdAt ?? new Date().toISOString(),
      seedSource: p.seedSource ?? "empty",
      shell: { alias: p.shell?.alias ?? `claude-${p.name}` },
    })),
    shell: { rcFile: r.shell?.rcFile ?? "" },
    sync: {
      enabled: r.sync?.enabled ?? false,
      remote: r.sync?.remote ?? "origin",
      branch: r.sync?.branch ?? "main",
    },
  };
  return out;
}

/**
 * Throws if any string in the config holds an absolute path. The only
 * portable path representations are profile-relative or `~`-prefixed.
 */
export function assertNoAbsolutePaths(cfg: HopperConfig): void {
  const json = JSON.stringify(cfg);
  // Allowed: `~`, `~/...`. Disallowed: `/Users/...`, `/home/...`, drive letters.
  const bad = json.match(/"\/(?:Users|home|root|var)\/[^"\\]*"/);
  if (bad) {
    throw new HopperError(
      `Config contains an absolute path: ${bad[0]}`,
      "This is a bug in claude-hopper. Please file an issue. Paths should be ~ or profile-relative.",
      "CONFIG_ABSOLUTE_PATH",
    );
  }
  const win = json.match(/"[A-Z]:\\\\[^"]*"/);
  if (win) {
    throw new HopperError(
      `Config contains a Windows absolute path: ${win[0]}`,
      "This is a bug. Paths should be ~ or profile-relative.",
      "CONFIG_ABSOLUTE_PATH",
    );
  }
}

export function getProfile(cfg: HopperConfig, name: string): ProfileEntry | undefined {
  return cfg.profiles.find((p) => p.name === name);
}

/**
 * Profile prefix matching. Returns:
 *  - the profile if name is an exact match
 *  - the profile if name is a unique prefix of exactly one profile
 *  - throws otherwise
 */
export function resolveProfileName(cfg: HopperConfig, name: string): ProfileEntry {
  const exact = cfg.profiles.find((p) => p.name === name);
  if (exact) return exact;
  const matches = cfg.profiles.filter((p) => p.name.startsWith(name));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new HopperError(
      `No profile matches "${name}".`,
      `Run \`claude-hopper profile list\` to see available profiles.`,
      "PROFILE_NOT_FOUND",
    );
  }
  throw new HopperError(
    `"${name}" is ambiguous; matches: ${matches.map((m) => m.name).join(", ")}.`,
    "Use a longer prefix or the exact profile name.",
    "PROFILE_AMBIGUOUS",
  );
}

const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function validateProfileName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new HopperError(
      `Invalid profile name "${name}".`,
      "Profile names must be 1–64 chars, start with a letter or digit, and contain only letters, digits, '-' or '_'.",
      "PROFILE_NAME_INVALID",
    );
  }
}

// re-exports for callers
export { tildify, untildify };
