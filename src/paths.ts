import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export function home(): string {
  const h = process.env.HOME ?? homedir();
  if (!h) {
    throw new Error(
      "Could not determine home directory. Set $HOME and re-run.",
    );
  }
  return h;
}

export function hopperDir(): string {
  return join(home(), ".claude-hopper");
}

export function profilesDir(): string {
  return join(hopperDir(), "profiles");
}

export function profileDir(name: string): string {
  return join(profilesDir(), name);
}

export function configPath(): string {
  return join(hopperDir(), "config.json");
}

export function gitignorePath(): string {
  return join(hopperDir(), ".gitignore");
}

export function syncRepoReadmePath(): string {
  return join(hopperDir(), "README.md");
}

export function canonicalClaudeDir(): string {
  return join(home(), ".claude");
}

export function stateDir(): string {
  return join(home(), ".local", "state", "claude-hopper");
}

export function lastActivePath(): string {
  return join(stateDir(), "last-active.json");
}

export function syncStatePath(): string {
  return join(stateDir(), "sync-state.json");
}

export function logDir(): string {
  return join(stateDir(), "log");
}

/**
 * Replace the resolved home prefix with `~` so paths are portable
 * across machines. Returns input unchanged if it does not start with home.
 */
export function tildify(p: string): string {
  const h = home();
  const abs = resolve(p);
  if (abs === h) return "~";
  if (abs.startsWith(h + sep)) {
    return "~" + abs.slice(h.length);
  }
  return p;
}

/**
 * Expand a leading `~` or `~/...` to an absolute path. Other paths pass
 * through. We do NOT support `~user` syntax.
 */
export function untildify(p: string): string {
  if (p === "~") return home();
  if (p.startsWith("~/") || p.startsWith("~" + sep)) {
    return join(home(), p.slice(2));
  }
  return p;
}

/**
 * True if path contains a hard-coded user home from another machine
 * (e.g. `/Users/foo/...` when our home is `/Users/bar`). Used by doctor.
 */
export function looksLikeForeignAbsolutePath(s: string): boolean {
  const h = home();
  const candidates = [/\/Users\/[^/"\\\s]+/g, /\/home\/[^/"\\\s]+/g];
  for (const re of candidates) {
    const matches = s.match(re);
    if (!matches) continue;
    for (const m of matches) {
      if (!h.startsWith(m)) return true;
    }
  }
  return false;
}
