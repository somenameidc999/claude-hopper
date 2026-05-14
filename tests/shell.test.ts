import { describe, test, expect } from "bun:test";
import {
  aliasBlock,
  hasAliasBlock,
  removeAliasBlockFromContent,
  replaceOrAppendAliasBlock,
} from "../src/shell.ts";

describe("shell alias blocks", () => {
  test("aliasBlock uses $HOME, never absolute paths", () => {
    const block = aliasBlock("zsh", "lazer", "claude-lazer");
    expect(block).toContain('$HOME');
    expect(block).not.toContain("/Users/");
    expect(block).not.toContain("/home/");
  });

  test("aliasBlock includes profile markers", () => {
    const block = aliasBlock("zsh", "lazer", "claude-lazer");
    expect(block).toContain("# >>> claude-hopper: lazer >>>");
    expect(block).toContain("# <<< claude-hopper: lazer <<<");
  });

  test("hasAliasBlock detects existing blocks", () => {
    const block = aliasBlock("zsh", "lazer", "claude-lazer");
    const rc = "# user stuff\nexport PATH=/usr/bin\n\n" + block + "\n";
    expect(hasAliasBlock(rc, "lazer")).toBe(true);
    expect(hasAliasBlock(rc, "contract")).toBe(false);
  });

  test("removeAliasBlockFromContent strips only the marked block", () => {
    const lazer = aliasBlock("zsh", "lazer", "claude-lazer");
    const contract = aliasBlock("zsh", "contract", "claude-contract");
    const rc = `export PATH=/usr/bin\n\n${lazer}\n\n${contract}\n\nalias ll='ls -la'\n`;
    const next = removeAliasBlockFromContent(rc, "lazer");
    expect(next).not.toContain("claude-hopper: lazer");
    expect(next).toContain("claude-hopper: contract");
    expect(next).toContain("alias ll='ls -la'");
    expect(next).toContain("export PATH=/usr/bin");
  });

  test("removeAliasBlockFromContent is a no-op if absent", () => {
    const rc = "export PATH=/usr/bin\n";
    expect(removeAliasBlockFromContent(rc, "lazer")).toBe(rc);
  });

  test("replaceOrAppendAliasBlock is idempotent", () => {
    const block = aliasBlock("zsh", "lazer", "claude-lazer");
    const rc1 = replaceOrAppendAliasBlock("export PATH=/usr/bin\n", block, "lazer");
    const rc2 = replaceOrAppendAliasBlock(rc1, block, "lazer");
    expect(rc1).toBe(rc2);
    // Only one occurrence of the start marker.
    expect((rc2.match(/>>> claude-hopper: lazer >>>/g) ?? []).length).toBe(1);
  });

  test("replaceOrAppendAliasBlock updates an existing block in place", () => {
    const oldBlock = aliasBlock("zsh", "lazer", "claude-lazer");
    const newBlock = aliasBlock("zsh", "lazer", "claude-lazer-renamed");
    const rc1 = replaceOrAppendAliasBlock("", oldBlock, "lazer");
    const rc2 = replaceOrAppendAliasBlock(rc1, newBlock, "lazer");
    expect(rc2).toContain("alias claude-lazer-renamed=");
    expect(rc2).not.toContain("alias claude-lazer=");
    // Single marker block.
    expect((rc2.match(/>>> claude-hopper: lazer >>>/g) ?? []).length).toBe(1);
  });

  test("fish alias syntax", () => {
    const block = aliasBlock("fish", "lazer", "claude-lazer");
    expect(block).toContain("alias claude-lazer '");
  });
});
