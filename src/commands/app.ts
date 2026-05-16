import { loadConfig, resolveProfileName, type ProfileEntry } from "../config.ts";
import { appBundlePath, tildify } from "../paths.ts";
import {
  appInstalled,
  assertMacOS,
  installApp,
  removeApp,
} from "../macapp.ts";
import * as log from "../logger.ts";

export interface AppFlags {
  json?: boolean;
}

function resolveTargets(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  name: string | undefined,
): ProfileEntry[] {
  if (name) return [resolveProfileName(cfg, name)];
  return cfg.profiles;
}

export async function runAppInstall(
  name: string | undefined,
  flags: AppFlags,
): Promise<void> {
  assertMacOS("Installing Mac apps");
  const cfg = await loadConfig();
  const targets = resolveTargets(cfg, name);

  if (targets.length === 0) {
    log.info("No profiles yet. Create one with `claude-hopper profile add <name>`.");
    if (flags.json) log.jsonOut({ installed: [] });
    return;
  }

  const installed: { name: string; path: string }[] = [];
  for (const p of targets) {
    const { path } = await installApp(p.name);
    installed.push({ name: p.name, path: tildify(path) });
    log.success(`Created ${tildify(path)}`);
  }
  log.dim("Launch from Spotlight, Finder (~/Applications), or drag one into the Dock.");
  if (flags.json) log.jsonOut({ installed });
}

export async function runAppRemove(
  name: string | undefined,
  flags: AppFlags,
): Promise<void> {
  const cfg = await loadConfig();
  const targets = resolveTargets(cfg, name);

  const removed: string[] = [];
  for (const p of targets) {
    try {
      const { changed } = await removeApp(p.name);
      if (changed) {
        removed.push(p.name);
        log.success(`Removed Mac app for "${p.name}".`);
      } else {
        log.info(`No Mac app bundle found for "${p.name}".`);
      }
    } catch (e) {
      log.warn((e as Error).message);
    }
  }
  if (flags.json) log.jsonOut({ removed });
}

export async function runAppList(flags: AppFlags): Promise<void> {
  const cfg = await loadConfig();
  const rows: { name: string; installed: boolean; path: string }[] = [];
  for (const p of cfg.profiles) {
    rows.push({
      name: p.name,
      installed: await appInstalled(p.name),
      path: tildify(appBundlePath(p.name)),
    });
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ apps: rows }, null, 2) + "\n");
    return;
  }

  if (rows.length === 0) {
    log.info("No profiles yet. Create one with `claude-hopper profile add <name>`.");
    return;
  }

  for (const r of rows) {
    const mark = r.installed
      ? log.c.green("✓ installed")
      : log.c.yellow("· not installed");
    log.out(`${r.name}  ${mark}  ${log.c.dim(r.path)}`);
  }
}
