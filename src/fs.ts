import { mkdir, readdir, rm, stat, cp, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function pathExistsSync(p: string): boolean {
  return existsSync(p);
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function readJson<T>(p: string): Promise<T> {
  const text = await readFile(p, "utf8");
  return JSON.parse(text) as T;
}

export async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + "\n";
  const tmp = p + ".tmp." + process.pid + "." + Date.now();
  await writeFile(tmp, text, "utf8");
  await rename(tmp, p);
}

export async function writeTextAtomic(p: string, text: string): Promise<void> {
  const tmp = p + ".tmp." + process.pid + "." + Date.now();
  await writeFile(tmp, text, "utf8");
  await rename(tmp, p);
}

export async function removePath(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

export interface CopyOptions {
  /** Relative-to-source-root path prefixes to skip entirely. */
  excludePrefixes?: string[];
  /** Glob-ish basename matches to skip at any depth. */
  excludeBasenames?: string[];
}

/**
 * Recursive copy with exclusion support. Exclusion is checked against
 * the entry's path relative to `from`.
 */
export async function copyTree(
  from: string,
  to: string,
  opts: CopyOptions = {},
): Promise<void> {
  if (!(await pathExists(from))) return;
  await ensureDir(to);
  await copyTreeInner(from, to, "", opts);
}

async function copyTreeInner(
  fromRoot: string,
  toRoot: string,
  rel: string,
  opts: CopyOptions,
): Promise<void> {
  const here = rel === "" ? fromRoot : join(fromRoot, rel);
  let entries;
  try {
    entries = await readdir(here, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const childRel = rel === "" ? e.name : join(rel, e.name);
    if (opts.excludeBasenames?.includes(e.name)) continue;
    if (
      opts.excludePrefixes?.some(
        (pre) => childRel === pre || childRel.startsWith(pre + "/"),
      )
    ) {
      continue;
    }
    const src = join(fromRoot, childRel);
    const dst = join(toRoot, childRel);
    if (e.isDirectory()) {
      await ensureDir(dst);
      await copyTreeInner(fromRoot, toRoot, childRel, opts);
    } else if (e.isSymbolicLink()) {
      // Copy by dereferencing — we don't want machine-specific symlinks.
      try {
        await cp(src, dst, { dereference: true, errorOnExist: false });
      } catch {
        // ignore broken symlinks
      }
    } else if (e.isFile()) {
      await cp(src, dst, { errorOnExist: false });
    }
  }
}
