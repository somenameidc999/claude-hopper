import { hostname } from "node:os";
import { writeTextAtomic, pathExists } from "../fs.ts";
import { gitignorePath, hopperDir, syncRepoReadmePath, tildify } from "../paths.ts";
import { GITIGNORE_TEMPLATE, SYNC_README_TEMPLATE } from "../templates.ts";
import { git, isHopperDirGitRepo } from "../git.ts";
import { loadConfig } from "../config.ts";
import { readSyncState, updateSyncState } from "../state.ts";
import { HopperError } from "../errors.ts";
import { runDoctor } from "./doctor.ts";
import * as log from "../logger.ts";
import pc from "picocolors";

export interface PushFlags {
  message?: string;
  force?: boolean;
  noVerify?: boolean;
  json?: boolean;
}

export interface PullFlags {
  discard?: boolean;
  noRepair?: boolean;
  json?: boolean;
}

export interface StatusFlags {
  json?: boolean;
}

async function ensureSyncReady(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.sync.enabled) {
    throw new HopperError(
      "Sync is not enabled.",
      "Run `claude-hopper init --remote <url>` to wire up a git remote.",
      "SYNC_DISABLED",
    );
  }
  if (!(await isHopperDirGitRepo())) {
    throw new HopperError(
      `${tildify(hopperDir())} is not a git repo.`,
      "Run `claude-hopper init --remote <url>` to set up the sync repo.",
      "SYNC_NOT_REPO",
    );
  }
}

export async function runSyncPush(flags: PushFlags): Promise<void> {
  await ensureSyncReady();
  const cfg = await loadConfig();

  // Ensure gitignore/README templates exist so commits include them.
  if (!(await pathExists(gitignorePath()))) {
    await writeTextAtomic(gitignorePath(), GITIGNORE_TEMPLATE);
  }
  if (!(await pathExists(syncRepoReadmePath()))) {
    await writeTextAtomic(syncRepoReadmePath(), SYNC_README_TEMPLATE);
  }

  // Doctor gate (unless --force).
  if (!flags.force) {
    log.step("Pre-flight: running doctor…");
    const report = await runDoctor({ silent: true });
    if (report.hasFailures) {
      // Re-run visibly so the user sees what's wrong.
      await runDoctor({});
      throw new HopperError(
        "Doctor found failures; refusing to push.",
        "Fix the issues above (or run `claude-hopper sync push --force` to push anyway).",
        "DOCTOR_FAIL",
      );
    }
  }

  log.step("Staging changes…");
  await git(["add", "-A"]);

  const status = await git(["status", "--porcelain"]);
  if (status.stdout.trim().length === 0) {
    log.info("Nothing to commit.");
  } else {
    const msg =
      flags.message ??
      `sync from ${hostname()} ${new Date().toISOString()}`;
    const args = ["commit", "-m", msg];
    if (flags.noVerify) args.push("--no-verify");
    log.step(`Committing: ${msg}`);
    await git(args);
  }

  log.step(`Pushing to ${cfg.sync.remote}/${cfg.sync.branch}…`);
  // Set upstream on first push to make later `git status` informative.
  await git(["push", "-u", cfg.sync.remote, `HEAD:${cfg.sync.branch}`]);

  await updateSyncState({ lastPushAt: new Date().toISOString() });
  log.success("Push complete.");
}

export async function runSyncPull(flags: PullFlags): Promise<void> {
  await ensureSyncReady();
  const cfg = await loadConfig();

  const dirty = await git(["status", "--porcelain"]);
  if (dirty.stdout.trim().length > 0 && !flags.discard) {
    throw new HopperError(
      "Local changes in ~/.claude-hopper would be overwritten by pull.",
      "Commit them with `claude-hopper sync push`, or re-run with `--discard` to drop them.",
      "PULL_DIRTY",
    );
  }
  if (flags.discard && dirty.stdout.trim().length > 0) {
    log.warn("Discarding local changes (--discard).");
    await git(["reset", "--hard", "HEAD"]);
    await git(["clean", "-fd"]);
  }

  log.step(`Pulling from ${cfg.sync.remote}/${cfg.sync.branch}…`);
  const r = await git(
    ["pull", "--ff-only", cfg.sync.remote, cfg.sync.branch],
    { allowFail: true },
  );
  if (r.code !== 0) {
    throw new HopperError(
      `Pull failed (not a fast-forward): ${r.stderr.trim()}`,
      `Resolve manually: \`cd ${tildify(hopperDir())} && git pull\` (or rebase/merge as appropriate).`,
      "PULL_NOT_FF",
    );
  }

  await updateSyncState({ lastPullAt: new Date().toISOString() });

  // After pull, run a repair pass to re-create missing alias entries, etc.
  if (!flags.noRepair) {
    log.step("Repairing local state…");
    await runDoctor({ repair: true });
  }
  log.success("Pull complete.");
}

export async function runSyncStatus(flags: StatusFlags): Promise<void> {
  await ensureSyncReady();
  const cfg = await loadConfig();
  const syncState = await readSyncState();

  const branchR = await git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
  const branch = branchR.stdout.trim() || "(no commits)";

  let ahead = 0;
  let behind = 0;
  const tracking = await git(
    ["rev-list", "--left-right", "--count", `HEAD...${cfg.sync.remote}/${cfg.sync.branch}`],
    { allowFail: true },
  );
  if (tracking.code === 0) {
    const parts = tracking.stdout.trim().split(/\s+/);
    ahead = Number(parts[0] ?? 0);
    behind = Number(parts[1] ?? 0);
  }

  const dirty = await git(["status", "--porcelain"]);
  const uncommittedFiles = dirty.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.slice(3));

  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          branch,
          remote: cfg.sync.remote,
          remoteBranch: cfg.sync.branch,
          ahead,
          behind,
          uncommittedFiles,
          lastPushAt: syncState.lastPushAt ?? null,
          lastPullAt: syncState.lastPullAt ?? null,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  process.stdout.write(pc.bold("Sync status\n"));
  process.stdout.write(`  branch:        ${branch}\n`);
  process.stdout.write(`  remote:        ${cfg.sync.remote}/${cfg.sync.branch}\n`);
  process.stdout.write(`  ahead/behind:  ${ahead} / ${behind}\n`);
  process.stdout.write(`  uncommitted:   ${uncommittedFiles.length} file(s)\n`);
  if (uncommittedFiles.length > 0) {
    for (const f of uncommittedFiles.slice(0, 10)) {
      process.stdout.write(pc.dim(`    - ${f}\n`));
    }
    if (uncommittedFiles.length > 10) {
      process.stdout.write(pc.dim(`    … and ${uncommittedFiles.length - 10} more\n`));
    }
  }
  process.stdout.write(`  last push:     ${syncState.lastPushAt ?? "—"}\n`);
  process.stdout.write(`  last pull:     ${syncState.lastPullAt ?? "—"}\n`);
}
