import prompts from "prompts";
import { loadConfigOrDefault } from "../config.ts";
import { hopperDir, stateDir, tildify } from "../paths.ts";
import { pathExists, removePath } from "../fs.ts";
import { removeAlias } from "../shell.ts";
import * as log from "../logger.ts";

export interface UninstallFlags {
  yes?: boolean;
  json?: boolean;
}

export async function runUninstall(flags: UninstallFlags): Promise<void> {
  const cfg = await loadConfigOrDefault();

  if (!flags.yes && !flags.json) {
    const ans = await prompts({
      type: "confirm",
      name: "ok",
      message: `Remove ${tildify(hopperDir())} and all shell aliases? This cannot be undone.`,
      initial: false,
    });
    if (!ans.ok) {
      log.info("Cancelled.");
      return;
    }
  }

  if (cfg.shell.rcFile) {
    for (const p of cfg.profiles) {
      const { changed } = await removeAlias(cfg.shell.rcFile, p.name);
      if (changed) log.info(`Removed alias for "${p.name}" from ${cfg.shell.rcFile}.`);
    }
  }

  if (await pathExists(hopperDir())) {
    await removePath(hopperDir());
    log.success(`Removed ${tildify(hopperDir())}`);
  }
  if (await pathExists(stateDir())) {
    await removePath(stateDir());
    log.success(`Removed ${tildify(stateDir())}`);
  }

  log.info("");
  log.info("Your default ~/.claude directory was left untouched.");
  log.info("To remove the package itself: `npm uninstall -g claude-hopper`.");
}
