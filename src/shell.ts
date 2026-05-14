import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { home, tildify, untildify } from "./paths.ts";
import { pathExists } from "./fs.ts";

export type ShellKind = "zsh" | "bash" | "fish" | "unknown";

export function detectShell(): ShellKind {
  const s = process.env.SHELL ?? "";
  const base = basename(s);
  if (base === "zsh") return "zsh";
  if (base === "bash") return "bash";
  if (base === "fish") return "fish";
  return "unknown";
}

export async function detectRcFile(): Promise<{ kind: ShellKind; rcFile: string }> {
  const kind = detectShell();
  const candidates: Record<ShellKind, string[]> = {
    zsh: [".zshrc"],
    bash: [".bashrc", ".bash_profile", ".profile"],
    fish: [".config/fish/config.fish"],
    unknown: [".profile"],
  };
  for (const c of candidates[kind]) {
    const p = join(home(), c);
    if (await pathExists(p)) return { kind, rcFile: p };
  }
  // Fall back to the first candidate even if it doesn't exist yet.
  return { kind, rcFile: join(home(), candidates[kind][0]!) };
}

function startMarker(name: string): string {
  return `# >>> claude-hopper: ${name} >>>`;
}
function endMarker(name: string): string {
  return `# <<< claude-hopper: ${name} <<<`;
}

export function aliasBlock(kind: ShellKind, profileName: string, alias: string): string {
  // For fish, use `abbr` or `alias` syntax. We use `alias` which works in fish too.
  if (kind === "fish") {
    return [
      startMarker(profileName),
      `alias ${alias} 'CLAUDE_CONFIG_DIR="$HOME/.claude-hopper/profiles/${profileName}" command claude'`,
      endMarker(profileName),
    ].join("\n");
  }
  return [
    startMarker(profileName),
    `alias ${alias}='CLAUDE_CONFIG_DIR="$HOME/.claude-hopper/profiles/${profileName}" command claude'`,
    endMarker(profileName),
  ].join("\n");
}

/**
 * Returns the rc-file content with the profile's alias block removed
 * (idempotent). Markers and the lines between them are stripped.
 */
export function removeAliasBlockFromContent(content: string, profileName: string): string {
  const start = startMarker(profileName);
  const end = endMarker(profileName);
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && line.trim() === start) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) out.push(line);
  }
  // Collapse any 3+ consecutive blank lines that may have been created.
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function hasAliasBlock(content: string, profileName: string): boolean {
  return content.includes(startMarker(profileName)) && content.includes(endMarker(profileName));
}

export function replaceOrAppendAliasBlock(
  content: string,
  block: string,
  profileName: string,
): string {
  if (hasAliasBlock(content, profileName)) {
    const stripped = removeAliasBlockFromContent(content, profileName);
    return appendBlock(stripped, block);
  }
  return appendBlock(content, block);
}

function appendBlock(content: string, block: string): string {
  const trimmed = content.replace(/\s+$/, "");
  if (trimmed.length === 0) return block + "\n";
  return trimmed + "\n\n" + block + "\n";
}

export async function installAlias(
  rcFile: string,
  kind: ShellKind,
  profileName: string,
  alias: string,
): Promise<{ changed: boolean }> {
  const absRc = untildify(rcFile);
  let existing = "";
  if (await pathExists(absRc)) {
    existing = await readFile(absRc, "utf8");
  }
  const block = aliasBlock(kind, profileName, alias);
  const next = replaceOrAppendAliasBlock(existing, block, profileName);
  if (next === existing) return { changed: false };
  await writeFile(absRc, next, "utf8");
  return { changed: true };
}

export async function removeAlias(
  rcFile: string,
  profileName: string,
): Promise<{ changed: boolean }> {
  const absRc = untildify(rcFile);
  if (!(await pathExists(absRc))) return { changed: false };
  const existing = await readFile(absRc, "utf8");
  const next = removeAliasBlockFromContent(existing, profileName);
  if (next === existing) return { changed: false };
  await writeFile(absRc, next, "utf8");
  return { changed: true };
}

export async function rcContainsAlias(rcFile: string, profileName: string): Promise<boolean> {
  const absRc = untildify(rcFile);
  if (!(await pathExists(absRc))) return false;
  const c = await readFile(absRc, "utf8");
  return hasAliasBlock(c, profileName);
}

export function aliasNameFor(profileName: string): string {
  return `claude-${profileName}`;
}

export { tildify };
