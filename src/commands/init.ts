import prompts from "prompts";
import {
  defaultConfig,
  loadConfigOrDefault,
  saveConfig,
} from "../config.ts";
import {
  canonicalClaudeDir,
  gitignorePath,
  hopperDir,
  syncRepoReadmePath,
  tildify,
} from "../paths.ts";
import { ensureDir, pathExists, writeTextAtomic } from "../fs.ts";
import { detectRcFile } from "../shell.ts";
import { GITIGNORE_TEMPLATE, SYNC_README_TEMPLATE } from "../templates.ts";
import { git, gitInstalled, isHopperDirGitRepo } from "../git.ts";
import * as log from "../logger.ts";
import { ensureProfilesRoot } from "../profile.ts";
import { HopperError } from "../errors.ts";
import { runDoctor } from "./doctor.ts";

export interface InitFlags {
  remote?: string;
  noSync?: boolean;
  yes?: boolean;
  json?: boolean;
}

export async function runInit(flags: InitFlags): Promise<void> {
  log.step(`Initializing claude-hopper at ${tildify(hopperDir())}`);
  await ensureDir(hopperDir());

  // Resolve sync preference up-front (interactive prompts may run here).
  let wantSync = false;
  let remote = flags.remote ?? "";
  if (flags.noSync) {
    wantSync = false;
  } else if (flags.remote) {
    wantSync = true;
  } else if (flags.yes) {
    wantSync = false;
  } else {
    const ans = await prompts({
      type: "confirm",
      name: "sync",
      message: "Sync profiles across machines via a git remote?",
      initial: true,
    });
    wantSync = !!ans.sync;
    if (wantSync) {
      const ans2 = await prompts({
        type: "text",
        name: "remote",
        message: "Git remote URL (leave blank to skip):",
        initial: "",
      });
      remote = (ans2.remote ?? "").trim();
      if (!remote) wantSync = false;
    }
  }

  // Sync wiring. Do this BEFORE loading config — a clone may write
  // config.json into the hopper dir, and we want to load that copy.
  if (wantSync) {
    if (!(await gitInstalled())) {
      throw new HopperError(
        "git is not installed or not on PATH.",
        "Install git (https://git-scm.com/) and re-run `claude-hopper init`, or use `--no-sync`.",
        "GIT_MISSING",
      );
    }
    await setupGitSync(remote);
  }

  await ensureProfilesRoot();

  // Now load (possibly cloned) config and merge in machine-specific bits.
  let cfg = await loadConfigOrDefault();

  // Shell detection — local concern, always re-detect.
  const detected = await detectRcFile();
  const detectedRc = tildify(detected.rcFile);
  if (!cfg.shell.rcFile) {
    cfg.shell.rcFile = detectedRc;
    log.info(`Detected shell rc file: ${cfg.shell.rcFile}`);
  }

  cfg.sync = wantSync
    ? { enabled: true, remote: "origin", branch: "main" }
    : { enabled: false, remote: "origin", branch: "main" };

  // Always ensure gitignore and README templates exist so they're committed
  // whenever sync is enabled later.
  if (!(await pathExists(gitignorePath()))) {
    await writeTextAtomic(gitignorePath(), GITIGNORE_TEMPLATE);
  }
  if (!(await pathExists(syncRepoReadmePath()))) {
    await writeTextAtomic(syncRepoReadmePath(), SYNC_README_TEMPLATE);
  }

  await saveConfig(cfg);

  // Offer to import any existing ~/.claude-* dirs as profiles (interactive only).
  if (!flags.yes && !flags.json) {
    // Intentionally simple: detection only, not auto-import. See `profile add`.
    // (Kept out of v1 to keep init dead-simple.)
    if (await pathExists(canonicalClaudeDir())) {
      log.dim(
        `Tip: seed your first profile from ~/.claude with \`claude-hopper profile add <name> --seed canonical\`.`,
      );
    }
  }

  // Best-effort doctor for newly-cloned state.
  if (cfg.profiles.length > 0) {
    log.info("");
    log.step("Running doctor on existing profiles…");
    await runDoctor({ repair: wantSync, json: false });
  }

  log.success("claude-hopper initialized.");
}

async function setupGitSync(remote: string): Promise<void> {
  const root = hopperDir();
  const isRepo = await isHopperDirGitRepo();
  if (isRepo) {
    log.info(`${tildify(root)} is already a git repo — leaving as is.`);
    // Make sure origin matches the requested remote.
    const cur = await git(["remote", "get-url", "origin"], { allowFail: true });
    if (cur.code === 0) {
      const currentRemote = cur.stdout.trim();
      if (currentRemote !== remote) {
        log.warn(
          `Existing origin is ${currentRemote}, not ${remote}. Leaving as-is. Run \`git remote set-url origin <url>\` inside ~/.claude-hopper to change it.`,
        );
      }
    } else {
      await git(["remote", "add", "origin", remote]);
      log.success(`Added remote origin → ${remote}`);
    }
    return;
  }

  // Probe the remote: does it already have a hopper repo on it?
  log.step(`Probing remote ${remote}…`);
  const probe = await git(["ls-remote", remote], {
    cwd: process.cwd(),
    allowFail: true,
  });
  const hasContent = probe.code === 0 && probe.stdout.trim().length > 0;

  if (hasContent) {
    log.step("Remote has content — cloning into the hopper dir…");
    // Clone needs an empty target. We may already have created hopperDir and
    // written gitignore/README templates. Move them aside, clone, then
    // restore-with-precedence-to-clone.
    const stashed: { path: string; tmp: string }[] = [];
    for (const p of [gitignorePath(), syncRepoReadmePath()]) {
      if (await pathExists(p)) {
        const tmp = p + ".pre-init.bak";
        await (await import("node:fs/promises")).rename(p, tmp);
        stashed.push({ path: p, tmp });
      }
    }
    try {
      // Clone into a sibling and merge. Cleanest cross-platform approach.
      const parent = (await import("node:path")).dirname(root);
      const tmpClone = root + ".clone." + Date.now();
      await git(["clone", remote, tmpClone], { cwd: parent });
      // Move .git and any tracked files from tmpClone into root.
      const fs = await import("node:fs/promises");
      const entries = await fs.readdir(tmpClone, { withFileTypes: true });
      for (const e of entries) {
        const src = (await import("node:path")).join(tmpClone, e.name);
        const dst = (await import("node:path")).join(root, e.name);
        if (await pathExists(dst)) {
          // Prefer the remote's version of common templates.
          await (await import("node:fs/promises")).rm(dst, {
            recursive: true,
            force: true,
          });
        }
        await fs.rename(src, dst);
      }
      await fs.rm(tmpClone, { recursive: true, force: true });
      log.success(`Cloned from ${remote}`);
    } finally {
      // Restore stashed files only if the clone didn't provide them.
      for (const s of stashed) {
        if (!(await pathExists(s.path))) {
          await (await import("node:fs/promises")).rename(s.tmp, s.path);
        } else {
          await (await import("node:fs/promises")).rm(s.tmp, { force: true });
        }
      }
    }
    return;
  }

  // Fresh remote — initialize, set remote, prepare initial commit.
  log.step("Remote is empty — initializing fresh repo…");
  await git(["init", "-b", "main"]);
  await git(["remote", "add", "origin", remote]);
}
