import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("paths", () => {
  test("tildify replaces home with ~", async () => {
    const { tildify } = await import("../src/paths.ts");
    expect(tildify(join(tmpHome, ".claude-hopper"))).toBe("~/.claude-hopper");
    expect(tildify(tmpHome)).toBe("~");
  });

  test("tildify leaves non-home paths alone", async () => {
    const { tildify } = await import("../src/paths.ts");
    expect(tildify("/var/tmp/foo")).toBe("/var/tmp/foo");
  });

  test("untildify expands ~", async () => {
    const { untildify } = await import("../src/paths.ts");
    expect(untildify("~/.zshrc")).toBe(join(tmpHome, ".zshrc"));
    expect(untildify("~")).toBe(tmpHome);
  });

  test("untildify leaves absolute paths alone", async () => {
    const { untildify } = await import("../src/paths.ts");
    expect(untildify("/etc/passwd")).toBe("/etc/passwd");
  });

  test("looksLikeForeignAbsolutePath flags other-user paths", async () => {
    const { looksLikeForeignAbsolutePath } = await import("../src/paths.ts");
    // tmpHome is /var/folders/... or /tmp/... so /Users/foo is foreign.
    expect(looksLikeForeignAbsolutePath('{"path": "/Users/someoneelse/.claude"}')).toBe(true);
    expect(looksLikeForeignAbsolutePath('{"path": "/home/bob/.claude"}')).toBe(true);
  });

  test("hopperDir composes from HOME", async () => {
    const { hopperDir } = await import("../src/paths.ts");
    expect(hopperDir()).toBe(join(tmpHome, ".claude-hopper"));
  });
});
