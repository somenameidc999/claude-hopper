import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let origHome: string | undefined;

beforeEach(async () => {
  origHome = process.env.HOME;
  tmpHome = await mkdtemp(join(tmpdir(), "hopper-test-"));
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("config", () => {
  test("validateProfileName accepts good names, rejects bad", async () => {
    const { validateProfileName } = await import("../src/config.ts");
    expect(() => validateProfileName("lazer")).not.toThrow();
    expect(() => validateProfileName("contract-2")).not.toThrow();
    expect(() => validateProfileName("a_b_c")).not.toThrow();

    expect(() => validateProfileName("")).toThrow();
    expect(() => validateProfileName("has space")).toThrow();
    expect(() => validateProfileName("-leading-dash")).toThrow();
    expect(() => validateProfileName("with/slash")).toThrow();
    expect(() => validateProfileName("dotted.name")).toThrow();
  });

  test("save/load round-trips", async () => {
    const cfgMod = await import("../src/config.ts");
    const cfg = cfgMod.defaultConfig();
    cfg.profiles.push({
      name: "personal",
      createdAt: "2026-05-14T10:30:00Z",
      seedSource: "empty",
      shell: { alias: "claude-personal" },
    });
    cfg.shell.rcFile = "~/.zshrc";
    await cfgMod.saveConfig(cfg);
    const loaded = await cfgMod.loadConfig();
    expect(loaded).toEqual(cfg);
  });

  test("config never contains absolute paths after save", async () => {
    const cfgMod = await import("../src/config.ts");
    const cfg = cfgMod.defaultConfig();
    cfg.profiles.push({
      name: "lazer",
      createdAt: new Date().toISOString(),
      seedSource: "empty",
      shell: { alias: "claude-lazer" },
    });
    cfg.shell.rcFile = "~/.zshrc";
    await cfgMod.saveConfig(cfg);
    const text = await readFile(join(tmpHome, ".claude-hopper", "config.json"), "utf8");
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/\/home\//);
    expect(text).not.toMatch(/[A-Z]:\\/);
  });

  test("assertNoAbsolutePaths rejects /Users/...", async () => {
    const { assertNoAbsolutePaths, defaultConfig } = await import("../src/config.ts");
    const cfg = defaultConfig();
    // Sneak an absolute path into a string field.
    cfg.shell.rcFile = "/Users/somebody/.zshrc";
    expect(() => assertNoAbsolutePaths(cfg)).toThrow(/absolute path/);
  });

  test("resolveProfileName matches unique prefixes", async () => {
    const { resolveProfileName, defaultConfig } = await import("../src/config.ts");
    const cfg = defaultConfig();
    cfg.profiles.push(
      { name: "lazer", createdAt: "x", seedSource: "empty", shell: { alias: "claude-lazer" } },
      { name: "contract", createdAt: "x", seedSource: "empty", shell: { alias: "claude-contract" } },
    );
    expect(resolveProfileName(cfg, "lazer").name).toBe("lazer");
    expect(resolveProfileName(cfg, "la").name).toBe("lazer");
    expect(resolveProfileName(cfg, "c").name).toBe("contract");
    expect(() => resolveProfileName(cfg, "nope")).toThrow(/No profile/);
  });

  test("resolveProfileName errors on ambiguous prefix", async () => {
    const { resolveProfileName, defaultConfig } = await import("../src/config.ts");
    const cfg = defaultConfig();
    cfg.profiles.push(
      { name: "lazer", createdAt: "x", seedSource: "empty", shell: { alias: "claude-lazer" } },
      { name: "lab", createdAt: "x", seedSource: "empty", shell: { alias: "claude-lab" } },
    );
    expect(() => resolveProfileName(cfg, "la")).toThrow(/ambiguous/);
  });
});
