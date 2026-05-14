import prompts from "prompts";
import {
  getProfile,
  loadConfig,
  saveConfig,
  validateProfileName,
  type SeedSource,
} from "../config.ts";
import { canonicalClaudeDir, profileDir, tildify } from "../paths.ts";
import { pathExists } from "../fs.ts";
import { aliasNameFor, detectShell, installAlias } from "../shell.ts";
import { ensureProfilesRoot, removeProfileDir, seedProfile } from "../profile.ts";
import { HopperError } from "../errors.ts";
import * as log from "../logger.ts";

export interface AddFlags {
  seed?: string;
  noAlias?: boolean;
  yes?: boolean;
  json?: boolean;
}

export async function runProfileAdd(name: string, flags: AddFlags): Promise<void> {
  validateProfileName(name);
  const cfg = await loadConfig();
  if (getProfile(cfg, name)) {
    throw new HopperError(
      `A profile named "${name}" already exists.`,
      `Run \`claude-hopper profile list\` to see it, or \`claude-hopper profile remove ${name}\` to delete it first.`,
      "PROFILE_EXISTS",
    );
  }

  const seed = await resolveSeed(cfg, flags);
  await ensureProfilesRoot();

  // Atomic-ish: if seed copy fails, remove the half-built dir.
  try {
    await seedProfile(name, seed);
  } catch (e) {
    await removeProfileDir(name).catch(() => {});
    throw e;
  }

  // Register in config.
  cfg.profiles.push({
    name,
    createdAt: new Date().toISOString(),
    seedSource: seed,
    shell: { alias: aliasNameFor(name) },
  });

  try {
    await saveConfig(cfg);
  } catch (e) {
    await removeProfileDir(name).catch(() => {});
    throw e;
  }

  // Install alias unless --no-alias.
  if (!flags.noAlias && cfg.shell.rcFile) {
    const kind = detectShell();
    const { changed } = await installAlias(
      cfg.shell.rcFile,
      kind,
      name,
      aliasNameFor(name),
    );
    if (changed) {
      log.success(`Registered alias \`${aliasNameFor(name)}\` in ${cfg.shell.rcFile}`);
      log.dim(`(reload your shell or run \`source ${cfg.shell.rcFile}\` to use it)`);
    } else {
      log.info(`Alias \`${aliasNameFor(name)}\` already present in ${cfg.shell.rcFile}.`);
    }
  }

  log.success(`Profile "${name}" created at ${tildify(profileDir(name))}.`);
  log.dim(`Next: \`claude-${name}\` (or \`claude-hopper run ${name}\`) to authenticate.`);
}

async function resolveSeed(
  cfg: import("../config.ts").HopperConfig,
  flags: AddFlags,
): Promise<SeedSource> {
  if (flags.seed) {
    const s = flags.seed.trim();
    if (s === "canonical" || s === "empty") return s;
    if (s.startsWith("clone:")) return s as SeedSource;
    throw new HopperError(
      `Unknown --seed value "${flags.seed}".`,
      "Use --seed canonical, --seed empty, or --seed clone:<name>.",
      "SEED_UNKNOWN",
    );
  }

  if (flags.yes || flags.json) return "empty";

  const choices: { title: string; value: SeedSource; disabled?: boolean; description?: string }[] = [];
  const canonicalExists = await pathExists(canonicalClaudeDir());
  choices.push({
    title: canonicalExists
      ? "Copy from ~/.claude (your default Claude Code config)"
      : "Copy from ~/.claude (not found — disabled)",
    value: "canonical",
    disabled: !canonicalExists,
  });
  for (const p of cfg.profiles) {
    choices.push({
      title: `Clone from existing profile "${p.name}"`,
      value: `clone:${p.name}` as SeedSource,
    });
  }
  choices.push({ title: "Empty profile (Claude will populate on first run)", value: "empty" });

  const ans = await prompts({
    type: "select",
    name: "seed",
    message: "Seed source for this profile?",
    choices: choices.map((c) => ({
      title: c.title,
      value: c.value,
      disabled: c.disabled,
    })),
    initial: 0,
  });
  if (!ans.seed) {
    throw new HopperError(
      "No seed source selected.",
      "Re-run and pick a seed, or pass --seed empty for a fresh profile.",
      "SEED_CANCELLED",
    );
  }
  return ans.seed as SeedSource;
}
