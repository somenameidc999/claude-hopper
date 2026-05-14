import { loadConfig, type ProfileEntry } from "../config.ts";
import { profileDir } from "../paths.ts";
import { pathExists } from "../fs.ts";
import { join } from "node:path";
import { rcContainsAlias } from "../shell.ts";
import { readLastActive } from "../state.ts";
import * as log from "../logger.ts";
import pc from "picocolors";

type Status = "healthy" | "needs-auth" | "missing-dir" | "corrupt" | "unknown";

interface ProfileRow {
  name: string;
  alias: string;
  status: Status;
  lastUsed: string;
  auth: "ok" | "missing";
}

export interface ListFlags {
  json?: boolean;
}

export async function runProfileList(flags: ListFlags): Promise<void> {
  const cfg = await loadConfig();
  const last = await readLastActive();

  const rows: ProfileRow[] = [];
  for (const p of cfg.profiles) {
    rows.push(await analyze(p, cfg.shell.rcFile, last?.profile === p.name ? last.at : undefined));
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ profiles: rows }, null, 2) + "\n");
    return;
  }

  if (rows.length === 0) {
    log.info("No profiles yet. Create one with `claude-hopper profile add <name>`.");
    return;
  }

  const widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    alias: Math.max(5, ...rows.map((r) => r.alias.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    lastUsed: Math.max(9, ...rows.map((r) => r.lastUsed.length)),
    auth: 4,
  };

  const header =
    pad("NAME", widths.name) +
    "  " +
    pad("ALIAS", widths.alias) +
    "  " +
    pad("STATUS", widths.status) +
    "  " +
    pad("LAST USED", widths.lastUsed) +
    "  " +
    pad("AUTH", widths.auth);
  process.stdout.write(pc.bold(header) + "\n");

  for (const r of rows) {
    process.stdout.write(
      pad(r.name, widths.name) +
        "  " +
        pad(r.alias, widths.alias) +
        "  " +
        pad(colorStatus(r.status), widths.status, r.status) +
        "  " +
        pad(r.lastUsed, widths.lastUsed) +
        "  " +
        pad(r.auth === "ok" ? pc.green("ok") : pc.yellow("missing"), 7, r.auth) +
        "\n",
    );
  }
}

function pad(s: string, w: number, raw?: string): string {
  // When colored, length includes ANSI escapes; use `raw` for measuring.
  const len = (raw ?? s).length;
  if (len >= w) return s;
  return s + " ".repeat(w - len);
}

function colorStatus(s: Status): string {
  switch (s) {
    case "healthy":
      return pc.green(s);
    case "needs-auth":
      return pc.yellow(s);
    case "missing-dir":
    case "corrupt":
      return pc.red(s);
    default:
      return pc.dim(s);
  }
}

async function analyze(
  p: ProfileEntry,
  rcFile: string,
  lastAt: string | undefined,
): Promise<ProfileRow> {
  const dir = profileDir(p.name);
  if (!(await pathExists(dir))) {
    return {
      name: p.name,
      alias: p.shell.alias,
      status: "missing-dir",
      lastUsed: "—",
      auth: "missing",
    };
  }
  const auth = (await pathExists(join(dir, ".credentials.json"))) ? "ok" : "missing";
  const settingsOk = await isJsonOk(join(dir, "settings.json"));
  let status: Status = "healthy";
  if (!settingsOk) status = "corrupt";
  else if (auth === "missing") status = "needs-auth";

  // Touch rc just to sanity-check it has the alias; we don't fail on it here.
  if (rcFile) {
    const ok = await rcContainsAlias(rcFile, p.name);
    if (!ok && status === "healthy") status = "unknown";
  }

  return {
    name: p.name,
    alias: p.shell.alias,
    status,
    lastUsed: lastAt ? formatDate(lastAt) : "—",
    auth,
  };
}

async function isJsonOk(p: string): Promise<boolean> {
  if (!(await pathExists(p))) return true; // absent is fine; Claude creates on first run
  try {
    const { readFile } = await import("node:fs/promises");
    JSON.parse(await readFile(p, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
