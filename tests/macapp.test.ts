import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let origHome: string | undefined;

beforeEach(async () => {
  origHome = process.env.HOME;
  tmpHome = await mkdtemp(join(tmpdir(), "hopper-app-"));
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("macapp templates", () => {
  test("launcherScript uses $HOME, never an absolute path", async () => {
    const { launcherScript } = await import("../src/macapp.ts");
    const s = launcherScript("work");
    expect(s).toContain("$HOME/.claude-hopper/profiles/work");
    expect(s).not.toContain("/Users/");
    expect(s).not.toContain("/home/");
    expect(s).not.toContain(tmpHome);
  });

  test("launcherScript mirrors the alias: sets CLAUDE_CONFIG_DIR and runs claude", async () => {
    const { launcherScript } = await import("../src/macapp.ts");
    const s = launcherScript("personal");
    expect(s).toContain('CLAUDE_CONFIG_DIR=\\"$HOME/.claude-hopper/profiles/personal\\"');
    expect(s).toContain("command claude");
    expect(s).toContain("#!/bin/bash");
  });

  test("launcherScript embeds an ownership marker", async () => {
    const { launcherScript } = await import("../src/macapp.ts");
    expect(launcherScript("work")).toContain("claude-hopper-app: work");
  });

  test("infoPlist carries name and reverse-DNS identifier", async () => {
    const { infoPlist } = await import("../src/macapp.ts");
    const p = infoPlist("work");
    expect(p).toContain("<string>Claude work</string>");
    expect(p).toContain("<string>com.claude-hopper.work</string>");
    expect(p).toContain("<string>launcher</string>");
  });

  test("bundle identifier maps underscores to hyphens", async () => {
    const { appBundleIdentifier } = await import("../src/paths.ts");
    expect(appBundleIdentifier("a_b_c")).toBe("com.claude-hopper.a-b-c");
  });
});

describe("macapp install/remove", () => {
  test("installApp writes a valid double-clickable bundle", async () => {
    const { installApp } = await import("../src/macapp.ts");
    const { appBundlePath } = await import("../src/paths.ts");
    const { path } = await installApp("work");
    expect(path).toBe(appBundlePath("work"));

    const plist = await readFile(join(path, "Contents", "Info.plist"), "utf8");
    expect(plist).toContain("com.claude-hopper.work");

    const launcherStat = await stat(join(path, "Contents", "MacOS", "launcher"));
    // Executable bit set for owner.
    expect(launcherStat.mode & 0o100).toBe(0o100);

    const pkg = await readFile(join(path, "Contents", "PkgInfo"), "utf8");
    expect(pkg).toBe("APPL????");
  });

  test("appInstalled reflects bundle presence", async () => {
    const { installApp, removeApp, appInstalled } = await import("../src/macapp.ts");
    expect(await appInstalled("work")).toBe(false);
    await installApp("work");
    expect(await appInstalled("work")).toBe(true);
    await removeApp("work");
    expect(await appInstalled("work")).toBe(false);
  });

  test("installApp is idempotent (refresh in place)", async () => {
    const { installApp } = await import("../src/macapp.ts");
    const a = await installApp("work");
    const b = await installApp("work");
    expect(a.path).toBe(b.path);
    expect(await appInstalledViaModule()).toBe(true);
  });

  test("install/remove refuse to touch a foreign same-named app", async () => {
    const { installApp, removeApp } = await import("../src/macapp.ts");
    const { appBundlePath } = await import("../src/paths.ts");
    const bundle = appBundlePath("work");
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(bundle, "Contents", "MacOS", "launcher"), "#!/bin/sh\nsomething-else\n");

    await expect(installApp("work")).rejects.toThrow(/not created by claude-hopper/);
    await expect(removeApp("work")).rejects.toThrow(/not created by claude-hopper/);
  });

  test("removeApp on an absent bundle is a no-op", async () => {
    const { removeApp } = await import("../src/macapp.ts");
    expect((await removeApp("nope")).changed).toBe(false);
  });
});

async function appInstalledViaModule(): Promise<boolean> {
  const { appInstalled } = await import("../src/macapp.ts");
  return appInstalled("work");
}
