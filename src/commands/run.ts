import { spawn } from "node:child_process";
import { loadConfig, resolveProfileName } from "../config.ts";
import { profileDir } from "../paths.ts";
import { ensureDir, pathExists } from "../fs.ts";
import { recordLastActive } from "../state.ts";
import * as log from "../logger.ts";
import { HopperError } from "../errors.ts";

export async function runRun(name: string, claudeArgs: string[]): Promise<number> {
  const cfg = await loadConfig();
  const target = resolveProfileName(cfg, name);
  const dir = profileDir(target.name);

  if (!(await pathExists(dir))) {
    log.warn(
      `Profile directory missing — recreating empty dir at ${dir}. Claude will repopulate on first run.`,
    );
    await ensureDir(dir);
  }

  await recordLastActive(target.name);

  // Find the `claude` binary on PATH. We use `command -v` semantics by
  // relying on spawn's PATH resolution. If `claude` isn't installed we want
  // a clean error rather than a confusing spawn ENOENT.
  const claudeBin = process.env.CLAUDE_HOPPER_CLAUDE_BIN ?? "claude";

  log.dim(`CLAUDE_CONFIG_DIR=${dir}`);
  log.dim(`exec: ${claudeBin} ${claudeArgs.join(" ")}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(claudeBin, claudeArgs, {
      stdio: "inherit",
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        reject(
          new HopperError(
            `Could not find the \`${claudeBin}\` executable on PATH.`,
            "Install Claude Code (https://claude.com/claude-code) or set CLAUDE_HOPPER_CLAUDE_BIN to a custom path.",
            "CLAUDE_BIN_MISSING",
          ),
        );
        return;
      }
      reject(e);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}
