import { describe, test, expect } from "bun:test";
import {
  aliasBlock,
  hasAliasBlock,
  removeAliasBlockFromContent,
  replaceOrAppendAliasBlock,
} from "../src/shell.ts";

describe("shell alias blocks", () => {
  test("aliasBlock uses $HOME, never absolute paths", () => {
    const block = aliasBlock("zsh", "work", "claude-work");
    expect(block).toContain('$HOME');
    expect(block).not.toContain("/Users/");
    expect(block).not.toContain("/home/");
  });

  test("aliasBlock includes profile markers", () => {
    const block = aliasBlock("zsh", "work", "claude-work");
    expect(block).toContain("# >>> claude-hopper: work >>>");
    expect(block).toContain("# <<< claude-hopper: work <<<");
  });

  test("hasAliasBlock detects existing blocks", () => {
    const block = aliasBlock("zsh", "work", "claude-work");
    const rc = "# user stuff\nexport PATH=/usr/bin\n\n" + block + "\n";
    expect(hasAliasBlock(rc, "work")).toBe(true);
    expect(hasAliasBlock(rc, "contract")).toBe(false);
  });

  test("removeAliasBlockFromContent strips only the marked block", () => {
    const work = aliasBlock("zsh", "work", "claude-work");
    const contract = aliasBlock("zsh", "contract", "claude-contract");
    const rc = `export PATH=/usr/bin\n\n${work}\n\n${contract}\n\nalias ll='ls -la'\n`;
    const next = removeAliasBlockFromContent(rc, "work");
    expect(next).not.toContain("claude-hopper: work");
    expect(next).toContain("claude-hopper: contract");
    expect(next).toContain("alias ll='ls -la'");
    expect(next).toContain("export PATH=/usr/bin");
  });

  test("removeAliasBlockFromContent is a no-op if absent", () => {
    const rc = "export PATH=/usr/bin\n";
    expect(removeAliasBlockFromContent(rc, "work")).toBe(rc);
  });

  test("replaceOrAppendAliasBlock is idempotent", () => {
    const block = aliasBlock("zsh", "work", "claude-work");
    const rc1 = replaceOrAppendAliasBlock("export PATH=/usr/bin\n", block, "work");
    const rc2 = replaceOrAppendAliasBlock(rc1, block, "work");
    expect(rc1).toBe(rc2);
    // Only one occurrence of the start marker.
    expect((rc2.match(/>>> claude-hopper: work >>>/g) ?? []).length).toBe(1);
  });

  test("replaceOrAppendAliasBlock updates an existing block in place", () => {
    const oldBlock = aliasBlock("zsh", "work", "claude-work");
    const newBlock = aliasBlock("zsh", "work", "claude-work-renamed");
    const rc1 = replaceOrAppendAliasBlock("", oldBlock, "work");
    const rc2 = replaceOrAppendAliasBlock(rc1, newBlock, "work");
    expect(rc2).toContain("alias claude-work-renamed=");
    expect(rc2).not.toContain("alias claude-work=");
    // Single marker block.
    expect((rc2.match(/>>> claude-hopper: work >>>/g) ?? []).length).toBe(1);
  });

  test("fish alias syntax", () => {
    const block = aliasBlock("fish", "work", "claude-work");
    expect(block).toContain("alias claude-work '");
  });
});
