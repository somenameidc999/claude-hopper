import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let origHome: string | undefined;
let origShell: string | undefined;

async function freshModules() {
  // Invalidate caches so each test sees a fresh HOME.
  // Bun's module cache cannot be cleared programmatically; the modules read
  // process.env.HOME at call time, so re-imports are unnecessary.
  return {
    init: await import("../src/commands/init.ts"),
    add: await import("../src/commands/profile-add.ts"),
    list: await import("../src/commands/profile-list.ts"),
    remove: await import("../src/commands/profile-remove.ts"),
    clone: await import("../src/commands/profile-clone.ts"),
    doctor: await import("../src/commands/doctor.ts"),
    config: await import("../src/config.ts"),
    paths: await import("../src/paths.ts"),
    logger: await import("../src/logger.ts"),
  };
}

beforeEach(async () => {
  origHome = process.env.HOME;
  origShell = process.env.SHELL;
  tmpHome = await mkdtemp(join(tmpdir(), "hopper-int-"));
  process.env.HOME = tmpHome;
  process.env.SHELL = "/bin/zsh";
  // Pre-create rc file so detectRcFile picks it up.
  await writeFile(join(tmpHome, ".zshrc"), "# user rc\n", "utf8");
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  if (origShell !== undefined) process.env.SHELL = origShell;
  else delete process.env.SHELL;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("init + profile lifecycle (no sync)", () => {
  test("init --no-sync --yes initializes config and dirs", async () => {
    const { init, paths, config } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    const cfg = await config.loadConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.sync.enabled).toBe(false);
    expect(cfg.shell.rcFile).toBe("~/.zshrc");
    const s = await stat(paths.profilesDir());
    expect(s.isDirectory()).toBe(true);
  });

  test("init is idempotent", async () => {
    const { init, config } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await init.runInit({ noSync: true, yes: true });
    const cfg = await config.loadConfig();
    expect(cfg.profiles).toHaveLength(0);
  });

  test("profile add --seed empty creates dir, registers alias, no absolute paths", async () => {
    const { init, add, config, paths } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });

    const cfg = await config.loadConfig();
    expect(cfg.profiles).toHaveLength(1);
    expect(cfg.profiles[0]!.name).toBe("work");
    expect(cfg.profiles[0]!.shell.alias).toBe("claude-work");

    const s = await stat(paths.profileDir("work"));
    expect(s.isDirectory()).toBe(true);

    const cfgText = await readFile(paths.configPath(), "utf8");
    expect(cfgText).not.toMatch(/\/Users\//);
    expect(cfgText).not.toMatch(/\/home\//);

    const rc = await readFile(join(tmpHome, ".zshrc"), "utf8");
    expect(rc).toContain(">>> claude-hopper: work >>>");
    expect(rc).toContain('$HOME/.claude-hopper/profiles/work');
    expect(rc).not.toContain(tmpHome);
  });

  test("profile add rejects duplicate names", async () => {
    const { init, add } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    await expect(add.runProfileAdd("work", { seed: "empty", yes: true })).rejects.toThrow(/already exists/);
  });

  test("profile clone copies files but excludes secrets", async () => {
    const { init, add, clone, paths } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    // Put a non-secret file and a secret in work.
    await writeFile(join(paths.profileDir("work"), "settings.json"), '{"foo":"bar"}\n');
    await writeFile(join(paths.profileDir("work"), ".credentials.json"), 'SECRET');
    await mkdir(join(paths.profileDir("work"), "projects"), { recursive: true });
    await writeFile(join(paths.profileDir("work"), "projects", "p.json"), 'machine-state');

    await clone.runProfileClone("work", "contract", { yes: true });

    const settings = await readFile(join(paths.profileDir("contract"), "settings.json"), "utf8");
    expect(settings).toBe('{"foo":"bar"}\n');

    // Credentials should NOT have been copied.
    const credExists = await stat(join(paths.profileDir("contract"), ".credentials.json")).then(
      () => true,
      () => false,
    );
    expect(credExists).toBe(false);

    // projects/ should NOT have been copied.
    const projExists = await stat(join(paths.profileDir("contract"), "projects")).then(
      () => true,
      () => false,
    );
    expect(projExists).toBe(false);
  });

  test("profile remove deletes dir, registry, and alias", async () => {
    const { init, add, remove, config, paths } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    await remove.runProfileRemove("work", { yes: true });

    const cfg = await config.loadConfig();
    expect(cfg.profiles).toHaveLength(0);

    const dirGone = await stat(paths.profileDir("work")).then(() => false, () => true);
    expect(dirGone).toBe(true);

    const rc = await readFile(join(tmpHome, ".zshrc"), "utf8");
    expect(rc).not.toContain("claude-hopper: work");
  });

  test("profile remove --keep-files preserves the directory", async () => {
    const { init, add, remove, paths } = await freshModules();
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    await remove.runProfileRemove("work", { yes: true, keepFiles: true });
    const s = await stat(paths.profileDir("work"));
    expect(s.isDirectory()).toBe(true);
  });

  test("doctor passes a clean setup", async () => {
    const { init, add, doctor, logger } = await freshModules();
    logger.setJsonMode(true); // suppress output
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    const report = await doctor.runDoctor({ silent: true });
    logger.setJsonMode(false);
    expect(report.hasFailures).toBe(false);
  });

  test("doctor --repair recreates a deleted profile dir", async () => {
    const { init, add, doctor, paths, logger } = await freshModules();
    logger.setJsonMode(true);
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    await rm(paths.profileDir("work"), { recursive: true, force: true });

    const before = await doctor.runDoctor({ silent: true });
    expect(before.hasFailures).toBe(true);

    await doctor.runDoctor({ repair: true, silent: true });
    const after = await doctor.runDoctor({ silent: true });
    logger.setJsonMode(false);
    expect(after.hasFailures).toBe(false);
  });

  test("doctor --repair reinstalls a missing alias", async () => {
    const { init, add, doctor, logger } = await freshModules();
    logger.setJsonMode(true);
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });

    // Manually nuke the alias block.
    const rcPath = join(tmpHome, ".zshrc");
    await writeFile(rcPath, "# user rc\n");

    const before = await doctor.runDoctor({ silent: true });
    expect(before.hasFailures).toBe(true);

    await doctor.runDoctor({ repair: true, silent: true });
    const rc = await readFile(rcPath, "utf8");
    expect(rc).toContain("claude-hopper: work");

    const after = await doctor.runDoctor({ silent: true });
    logger.setJsonMode(false);
    expect(after.hasFailures).toBe(false);
  });

  test("doctor flags foreign absolute paths inside a profile", async () => {
    const { init, add, doctor, paths, logger } = await freshModules();
    logger.setJsonMode(true);
    await init.runInit({ noSync: true, yes: true });
    await add.runProfileAdd("work", { seed: "empty", yes: true });
    await writeFile(
      join(paths.profileDir("work"), "settings.json"),
      JSON.stringify({ note: "from /Users/somebody-else/.claude" }),
    );
    const report = await doctor.runDoctor({ silent: true });
    logger.setJsonMode(false);
    expect(report.hasFailures).toBe(true);
  });
});
