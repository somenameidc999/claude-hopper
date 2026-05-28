import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let origHome: string | undefined;

beforeEach(async () => {
  origHome = process.env.HOME;
  tmpHome = await mkdtemp(join(tmpdir(), "hopper-flags-"));
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

async function writeClaudeJson(profile: string, data: unknown): Promise<string> {
  const dir = join(tmpHome, ".claude-hopper", "profiles", profile);
  await mkdir(dir, { recursive: true });
  const p = join(dir, ".claude.json");
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
  return p;
}

describe("flags", () => {
  test("readFlagSnapshot counts flags and reads timestamp", async () => {
    const { readFlagSnapshot } = await import("../src/flags.ts");
    await writeClaudeJson("personal", {
      oauthAccount: { emailAddress: "a@b.com" },
      cachedGrowthBookFeatures: { a: true, b: false, c: 1 },
      cachedExperimentFeatures: ["x", "y"],
      cachedGrowthBookFeaturesAt: 123456,
    });
    const snap = await readFlagSnapshot("personal");
    expect(snap).toEqual({ gb: 3, exp: 2, at: 123456 });
  });

  test("readFlagSnapshot zeroes a missing file", async () => {
    const { readFlagSnapshot } = await import("../src/flags.ts");
    expect(await readFlagSnapshot("ghost")).toEqual({ gb: 0, exp: 0, at: null });
  });

  test("invalidateFlagCache drops only the cache keys, preserves the rest", async () => {
    const { invalidateFlagCache } = await import("../src/flags.ts");
    const p = await writeClaudeJson("personal", {
      oauthAccount: { emailAddress: "a@b.com" },
      numStartups: 7,
      cachedGrowthBookFeatures: { a: true },
      cachedExperimentFeatures: ["x"],
      cachedGrowthBookFeaturesAt: 999,
    });
    const changed = await invalidateFlagCache("personal");
    expect(changed).toBe(true);

    const after = JSON.parse(await readFile(p, "utf8"));
    expect(after.cachedGrowthBookFeatures).toBeUndefined();
    expect(after.cachedExperimentFeatures).toBeUndefined();
    expect(after.cachedGrowthBookFeaturesAt).toBeUndefined();
    // Untouched state survives.
    expect(after.oauthAccount).toEqual({ emailAddress: "a@b.com" });
    expect(after.numStartups).toBe(7);
  });

  test("invalidateFlagCache is a no-op when there is nothing cached", async () => {
    const { invalidateFlagCache } = await import("../src/flags.ts");
    await writeClaudeJson("personal", { numStartups: 1 });
    expect(await invalidateFlagCache("personal")).toBe(false);
  });

  test("invalidateFlagCache returns false for a missing file", async () => {
    const { invalidateFlagCache } = await import("../src/flags.ts");
    expect(await invalidateFlagCache("ghost")).toBe(false);
  });
});
