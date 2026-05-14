import { loadConfig, resolveProfileName } from "../config.ts";
import { aliasNameFor, detectShell, installAlias, removeAlias } from "../shell.ts";
import { HopperError } from "../errors.ts";
import * as log from "../logger.ts";

export async function runAliasInstall(name: string): Promise<void> {
  const cfg = await loadConfig();
  const target = resolveProfileName(cfg, name);
  if (!cfg.shell.rcFile) {
    throw new HopperError(
      "No shell rc file is configured.",
      "Re-run `claude-hopper init` to detect your shell.",
      "SHELL_NOT_CONFIGURED",
    );
  }
  const kind = detectShell();
  const res = await installAlias(cfg.shell.rcFile, kind, target.name, aliasNameFor(target.name));
  if (res.changed) {
    log.success(`Installed alias \`${aliasNameFor(target.name)}\` in ${cfg.shell.rcFile}.`);
  } else {
    log.info(`Alias already present in ${cfg.shell.rcFile}.`);
  }
}

export async function runAliasRemove(name: string): Promise<void> {
  const cfg = await loadConfig();
  const target = resolveProfileName(cfg, name);
  if (!cfg.shell.rcFile) return;
  const res = await removeAlias(cfg.shell.rcFile, target.name);
  if (res.changed) {
    log.success(`Removed alias \`${aliasNameFor(target.name)}\` from ${cfg.shell.rcFile}.`);
  } else {
    log.info(`No alias block found in ${cfg.shell.rcFile}.`);
  }
}
