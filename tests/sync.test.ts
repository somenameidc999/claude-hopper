import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let testRoot: string;
let homeA: string;
let homeB: string;
let bareRepo: string;
let origHome: string | undefined;
let origShell: string | undefined;

function gitSync(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 0, stdout: r.stdout, stderr: r.stderr };
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    if (prev !== undefined) process.env.HOME = prev;
  }
}

beforeEach(async () => {
  origHome = process.env.HOME;
  origShell = process.env.SHELL;
  process.env.SHELL = "/bin/zsh";
  testRoot = await mkdtemp(join(tmpdir(), "hopper-sync-"));
  homeA = join(testRoot, "home-a");
  homeB = join(testRoot, "home-b");
  bareRepo = join(testRoot, "remote.git");
  const fs = await import("node:fs/promises");
  await fs.mkdir(homeA, { recursive: true });
  await fs.mkdir(homeB, { recursive: true });
  await writeFile(join(homeA, ".zshrc"), "# A\n");
  await writeFile(join(homeB, ".zshrc"), "# B\n");
  gitSync(["init", "--bare", "-b", "main", bareRepo], testRoot);

  // Configure git identity for the test process.
  process.env.GIT_AUTHOR_NAME = "Hopper Test";
  process.env.GIT_AUTHOR_EMAIL = "test@example.com";
  process.env.GIT_COMMITTER_NAME = "Hopper Test";
  process.env.GIT_COMMITTER_EMAIL = "test@example.com";
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  if (origShell !== undefined) process.env.SHELL = origShell;
  else delete process.env.SHELL;
  await rm(testRoot, { recursive: true, force: true });
});

describe("sync round-trip", () => {
  test("push from A, pull on B, profiles materialize with aliases", async () => {
    const { runInit } = await import("../src/commands/init.ts");
    const { runProfileAdd } = await import("../src/commands/profile-add.ts");
    const { runSyncPush, runSyncPull } = await import("../src/commands/sync.ts");
    const { setJsonMode } = await import("../src/logger.ts");
    const { profileDir } = await import("../src/paths.ts");

    setJsonMode(true);

    // Machine A: init with bare repo as remote, add profiles, push.
    await withHome(homeA, async () => {
      await runInit({ remote: bareRepo, yes: true });
      await runProfileAdd("lazer", { seed: "empty", yes: true });
      await runProfileAdd("contract", { seed: "empty", yes: true });
      // Put a tracked file in lazer.
      await writeFile(join(profileDir("lazer"), "settings.json"), '{"theme":"dark"}\n');
      await writeFile(join(profileDir("lazer"), "CLAUDE.md"), "# lazer instructions\n");
      // Drop a credential file that should NOT be synced.
      await writeFile(join(profileDir("lazer"), ".credentials.json"), "MACHINE-A-SECRET");
      await runSyncPush({ force: false });
    });

    // Machine B: init clones the remote, profiles materialize.
    await withHome(homeB, async () => {
      await runInit({ remote: bareRepo, yes: true });

      const { loadConfig } = await import("../src/config.ts");
      const cfg = await loadConfig();
      expect(cfg.profiles.map((p) => p.name).sort()).toEqual(["contract", "lazer"]);

      // Profile dirs exist.
      const lazerStat = await stat(profileDir("lazer"));
      expect(lazerStat.isDirectory()).toBe(true);

      // Tracked file came through.
      const settings = await readFile(join(profileDir("lazer"), "settings.json"), "utf8");
      expect(settings).toBe('{"theme":"dark"}\n');

      // Credentials did NOT come through.
      const credExists = await stat(join(profileDir("lazer"), ".credentials.json")).then(
        () => true,
        () => false,
      );
      expect(credExists).toBe(false);

      // Alias was installed for both profiles.
      const rc = await readFile(join(homeB, ".zshrc"), "utf8");
      expect(rc).toContain("claude-hopper: lazer");
      expect(rc).toContain("claude-hopper: contract");
      // And points at $HOME, not the machine A home.
      expect(rc).not.toContain(homeA);
      expect(rc).toContain("$HOME/.claude-hopper/profiles/lazer");

      // Another pull is a no-op.
      await runSyncPull({});
    });

    setJsonMode(false);
  });

  test("pull refuses dirty tree without --discard", async () => {
    const { runInit } = await import("../src/commands/init.ts");
    const { runProfileAdd } = await import("../src/commands/profile-add.ts");
    const { runSyncPush, runSyncPull } = await import("../src/commands/sync.ts");
    const { setJsonMode } = await import("../src/logger.ts");
    const { profileDir } = await import("../src/paths.ts");

    setJsonMode(true);

    await withHome(homeA, async () => {
      await runInit({ remote: bareRepo, yes: true });
      await runProfileAdd("lazer", { seed: "empty", yes: true });
      await runSyncPush({});
    });

    await withHome(homeB, async () => {
      await runInit({ remote: bareRepo, yes: true });
      // Make B dirty.
      await writeFile(join(profileDir("lazer"), "dirty.txt"), "uncommitted");
      await expect(runSyncPull({})).rejects.toThrow(/overwritten|Local changes/i);
      await runSyncPull({ discard: true });
    });

    setJsonMode(false);
  });
});
