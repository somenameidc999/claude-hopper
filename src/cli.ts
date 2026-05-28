import { cac } from "cac";
import { isHopperError } from "./errors.ts";
import * as log from "./logger.ts";
import { runInit } from "./commands/init.ts";
import { runProfileAdd } from "./commands/profile-add.ts";
import { runProfileList } from "./commands/profile-list.ts";
import { runProfileRemove } from "./commands/profile-remove.ts";
import { runProfileClone } from "./commands/profile-clone.ts";
import { runAliasInstall, runAliasRemove } from "./commands/profile-alias.ts";
import { runRun } from "./commands/run.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runRefreshFlags } from "./commands/refresh-flags.ts";
import { runSyncPull, runSyncPush, runSyncStatus } from "./commands/sync.ts";
import { runUninstall } from "./commands/uninstall.ts";

const VERSION = "0.1.0";

function applyJsonFlag(opts: Record<string, unknown>) {
  if (opts.json) log.setJsonMode(true);
}

/**
 * cac doesn't natively dispatch multi-word commands like `profile add`.
 * We collapse them into single tokens before parsing, so users still type
 * the natural form (`claude-hopper profile add foo`) but cac sees `profile-add foo`.
 */
function normalizeArgv(argv: string[]): string[] {
  const known = new Set([
    "profile add",
    "profile list",
    "profile ls",
    "profile remove",
    "profile rm",
    "profile clone",
    "profile alias-install",
    "profile alias-remove",
    "sync push",
    "sync pull",
    "sync status",
  ]);
  const rest = argv.slice(2);
  if (rest.length >= 2) {
    const compound = `${rest[0]} ${rest[1]}`;
    if (known.has(compound)) {
      const collapsed = compound.replace(" ", "-");
      return [argv[0]!, argv[1]!, collapsed, ...rest.slice(2)];
    }
  }
  return argv;
}

async function main() {
  const cli = cac("claude-hopper");

  cli
    .command("init", "Initialize claude-hopper on this machine")
    .option("--remote <url>", "Git remote URL for sync")
    .option("--no-sync", "Initialize without git sync")
    .option("--yes", "Non-interactive, accept defaults")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runInit({
        remote: opts.remote,
        noSync: opts.sync === false,
        yes: opts.yes,
        json: opts.json,
      });
    });

  cli
    .command("profile-add <name>", "Create a new profile")
    .option("--seed <source>", "Seed: canonical | empty | clone:<name>")
    .option("--no-alias", "Skip shell alias registration")
    .option("--yes", "Non-interactive")
    .option("--json", "Machine-readable output")
    .action(async (name, opts) => {
      applyJsonFlag(opts);
      await runProfileAdd(name, {
        seed: opts.seed,
        noAlias: opts.alias === false,
        yes: opts.yes,
        json: opts.json,
      });
    });

  cli
    .command("profile-list", "List all profiles")
    .alias("profile-ls")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runProfileList({ json: opts.json });
    });

  cli
    .command("profile-remove <name>", "Remove a profile")
    .alias("profile-rm")
    .option("--keep-files", "Remove from registry but keep profile dir on disk")
    .option("--yes", "Skip confirmation")
    .option("--json", "Machine-readable output")
    .action(async (name, opts) => {
      applyJsonFlag(opts);
      await runProfileRemove(name, {
        keepFiles: opts.keepFiles,
        yes: opts.yes,
        json: opts.json,
      });
    });

  cli
    .command("profile-clone <source> <new-name>", "Clone an existing profile")
    .option("--yes", "Non-interactive")
    .option("--no-alias", "Skip shell alias registration")
    .option("--json", "Machine-readable output")
    .action(async (source, newName, opts) => {
      applyJsonFlag(opts);
      await runProfileClone(source, newName, {
        yes: opts.yes,
        noAlias: opts.alias === false,
        json: opts.json,
      });
    });

  cli
    .command("profile-alias-install <name>", "Install shell alias for a profile")
    .action(async (name) => {
      await runAliasInstall(name);
    });

  cli
    .command("profile-alias-remove <name>", "Remove shell alias for a profile")
    .action(async (name) => {
      await runAliasRemove(name);
    });

  cli
    .command("run <name> [...args]", "Launch Claude Code with a profile")
    .allowUnknownOptions()
    .action(async (name, args, _opts) => {
      const passthrough = Array.isArray(args) ? args : [];
      const code = await runRun(name, passthrough);
      process.exit(code);
    });

  cli
    .command("doctor", "Health-check profiles and configuration")
    .option("--repair", "Attempt to fix issues")
    .option("--profile <name>", "Check only a single profile")
    .option("--strict", "Exit non-zero on any warning")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      const report = await runDoctor({
        repair: opts.repair,
        profile: opts.profile,
        strict: opts.strict,
        json: opts.json,
      });
      if (report.hasFailures) process.exit(1);
      if (opts.strict && report.hasWarnings) process.exit(2);
    });

  cli
    .command("refresh-flags", "Refetch each profile's Claude feature flags")
    .option("--profile <name>", "Refresh only a single profile")
    .option("--lazy", "Just invalidate the cache; refetch on next launch (no API call)")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runRefreshFlags({
        profile: opts.profile,
        lazy: opts.lazy,
        json: opts.json,
      });
    });

  cli
    .command("sync-push", "Commit and push the hopper repo")
    .option("--message <msg>", "Commit message")
    .option("--force", "Skip doctor pre-check")
    .option("--no-verify", "Skip git pre-push hooks")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runSyncPush({
        message: opts.message,
        force: opts.force,
        noVerify: opts.verify === false,
        json: opts.json,
      });
    });

  cli
    .command("sync-pull", "Fast-forward pull the hopper repo")
    .option("--discard", "Discard local uncommitted changes")
    .option("--no-repair", "Skip post-pull doctor --repair")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runSyncPull({
        discard: opts.discard,
        noRepair: opts.repair === false,
        json: opts.json,
      });
    });

  cli
    .command("sync-status", "Show sync status")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runSyncStatus({ json: opts.json });
    });

  cli
    .command("uninstall", "Remove all claude-hopper state from this machine")
    .option("--yes", "Skip confirmation")
    .option("--json", "Machine-readable output")
    .action(async (opts) => {
      applyJsonFlag(opts);
      await runUninstall({ yes: opts.yes, json: opts.json });
    });

  cli.help();
  cli.version(VERSION);

  // cac's parse runs the matched action.
  try {
    cli.parse(normalizeArgv(process.argv), { run: false });
    await cli.runMatchedCommand();
  } catch (e) {
    handleError(e);
    process.exit(1);
  }
}

function handleError(e: unknown): void {
  if (isHopperError(e)) {
    log.err(e.message);
    log.info(`  fix: ${e.remediation}`);
    return;
  }
  if (e instanceof Error) {
    log.err(e.message);
    if (process.env.CLAUDE_HOPPER_DEBUG) {
      process.stderr.write((e.stack ?? "") + "\n");
    } else {
      log.info("  Re-run with CLAUDE_HOPPER_DEBUG=1 for a stack trace.");
    }
    return;
  }
  log.err(String(e));
}

main();
