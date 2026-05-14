import prompts from "prompts";
import { loadConfig, resolveProfileName, saveConfig } from "../config.ts";
import { removeAlias } from "../shell.ts";
import { removeProfileDir } from "../profile.ts";
import * as log from "../logger.ts";

export interface RemoveFlags {
  keepFiles?: boolean;
  yes?: boolean;
  json?: boolean;
}

export async function runProfileRemove(name: string, flags: RemoveFlags): Promise<void> {
  const cfg = await loadConfig();
  const target = resolveProfileName(cfg, name);

  if (!flags.yes && !flags.json) {
    const ans = await prompts({
      type: "confirm",
      name: "ok",
      message: flags.keepFiles
        ? `Remove profile "${target.name}" from the registry (keeping files on disk)?`
        : `Permanently delete profile "${target.name}" and its directory?`,
      initial: false,
    });
    if (!ans.ok) {
      log.info("Cancelled.");
      return;
    }
  }

  if (!flags.keepFiles) {
    await removeProfileDir(target.name);
  }

  if (cfg.shell.rcFile) {
    const { changed } = await removeAlias(cfg.shell.rcFile, target.name);
    if (changed) log.info(`Removed alias block from ${cfg.shell.rcFile}.`);
  }

  cfg.profiles = cfg.profiles.filter((p) => p.name !== target.name);
  await saveConfig(cfg);

  log.success(
    flags.keepFiles
      ? `Removed profile "${target.name}" from registry. Files remain on disk.`
      : `Removed profile "${target.name}".`,
  );
}
