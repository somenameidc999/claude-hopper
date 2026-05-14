import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadConfig,
  type ProfileEntry,
} from "../config.ts";
import { profileDir } from "../paths.ts";
import { ensureDir, pathExists } from "../fs.ts";
import {
  aliasNameFor,
  detectShell,
  installAlias,
  rcContainsAlias,
} from "../shell.ts";
import { looksLikeForeignAbsolutePath } from "../paths.ts";
import * as log from "../logger.ts";
import pc from "picocolors";

export interface DoctorFlags {
  repair?: boolean;
  profile?: string;
  strict?: boolean;
  json?: boolean;
  silent?: boolean;
}

interface Check {
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  fix?: string;
}

interface ProfileReport {
  name: string;
  checks: Check[];
}

interface DoctorReport {
  profiles: ProfileReport[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

export async function runDoctor(flags: DoctorFlags): Promise<DoctorReport> {
  const cfg = await loadConfig();
  const rcFile = cfg.shell.rcFile;
  const kind = detectShell();

  const targets: ProfileEntry[] = flags.profile
    ? cfg.profiles.filter((p) => p.name === flags.profile)
    : cfg.profiles;

  const report: DoctorReport = { profiles: [], hasFailures: false, hasWarnings: false };

  for (const p of targets) {
    const checks: Check[] = [];

    const dir = profileDir(p.name);

    // Check 1: directory exists.
    if (await pathExists(dir)) {
      checks.push({ label: "Directory exists", status: "ok" });
    } else if (flags.repair) {
      await ensureDir(dir);
      checks.push({ label: "Directory exists (recreated)", status: "ok" });
    } else {
      checks.push({
        label: "Directory exists",
        status: "fail",
        detail: `Missing: ${dir}`,
        fix: `claude-hopper doctor --repair --profile ${p.name}`,
      });
    }

    // Check 2: settings.json parses (only if it exists).
    const settingsPath = join(dir, "settings.json");
    if (await pathExists(settingsPath)) {
      try {
        JSON.parse(await readFile(settingsPath, "utf8"));
        checks.push({ label: "settings.json valid", status: "ok" });
      } catch (e) {
        checks.push({
          label: "settings.json valid",
          status: "fail",
          detail: (e as Error).message,
          fix: `Edit ${settingsPath} to fix the JSON, or restore from \`git checkout\` inside ~/.claude-hopper.`,
        });
      }
    } else {
      checks.push({ label: "settings.json present", status: "warn", detail: "absent (Claude will create on first run)" });
    }

    // Check 3: shell alias installed.
    if (rcFile) {
      const present = await rcContainsAlias(rcFile, p.name);
      if (present) {
        checks.push({ label: `Alias in ${rcFile}`, status: "ok" });
      } else if (flags.repair) {
        await installAlias(rcFile, kind, p.name, aliasNameFor(p.name));
        checks.push({ label: `Alias in ${rcFile} (installed)`, status: "ok" });
      } else {
        checks.push({
          label: `Alias in ${rcFile}`,
          status: "fail",
          detail: "missing",
          fix: `claude-hopper profile alias-install ${p.name}`,
        });
      }
    }

    // Check 4: no foreign absolute paths inside profile.
    // Split by file type: code/config files fail the build; documentation
    // files only warn (they often contain example/placeholder paths).
    const { hard, soft } = await scanForForeignAbsolute(dir);
    if (hard.length === 0 && soft.length === 0) {
      checks.push({ label: "No foreign absolute paths", status: "ok" });
    } else {
      if (hard.length > 0) {
        checks.push({
          label: "No foreign absolute paths (config/code)",
          status: "fail",
          detail: `Found in: ${hard.slice(0, 3).join(", ")}${hard.length > 3 ? ` (+${hard.length - 3} more)` : ""}`,
          fix: "Open these files and replace the absolute paths with portable references.",
        });
      }
      if (soft.length > 0) {
        checks.push({
          label: "No foreign absolute paths (docs)",
          status: "warn",
          detail: `Found in: ${soft.slice(0, 3).join(", ")}${soft.length > 3 ? ` (+${soft.length - 3} more)` : ""}`,
          fix: "These look like documentation examples. Review and edit to use placeholder syntax if you want them sync-clean.",
        });
      }
    }

    // Check 5: auth.
    if (await pathExists(join(dir, ".credentials.json"))) {
      checks.push({ label: "Auth credentials present", status: "ok" });
    } else {
      checks.push({
        label: "Auth credentials present",
        status: "warn",
        detail: "missing",
        fix: `Run \`claude-${p.name}\` (or \`claude-hopper run ${p.name}\`) to OAuth.`,
      });
    }

    report.profiles.push({ name: p.name, checks });
  }

  for (const r of report.profiles) {
    for (const c of r.checks) {
      if (c.status === "fail") report.hasFailures = true;
      if (c.status === "warn") report.hasWarnings = true;
    }
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  }

  if (!flags.silent && process.env.CLAUDE_HOPPER_QUIET !== "1") {
    if (report.profiles.length === 0) {
      log.info("No profiles to check.");
    }
    for (const r of report.profiles) {
      process.stdout.write(pc.bold(`\nProfile: ${r.name}\n`));
      for (const c of r.checks) {
        const icon =
          c.status === "ok" ? pc.green("  ✓") : c.status === "warn" ? pc.yellow("  ⚠") : pc.red("  ✗");
        process.stdout.write(`${icon} ${c.label}${c.detail ? pc.dim(` — ${c.detail}`) : ""}\n`);
        if (c.fix && c.status !== "ok") {
          process.stdout.write(pc.dim(`     fix: ${c.fix}\n`));
        }
      }
    }
  }

  return report;
}

async function scanForForeignAbsolute(dir: string): Promise<{ hard: string[]; soft: string[] }> {
  const hard: string[] = [];
  const soft: string[] = [];
  if (!(await pathExists(dir))) return { hard, soft };
  const { readdir, readFile, stat } = await import("node:fs/promises");

  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        // Skip per-machine state — those are allowed to have absolute paths.
        if (
          [
            "projects",
            "todos",
            "session-env",
            "statsig",
            "cache",
            "locks",
            "shell-snapshots",
            "paste-cache",
            "marketplaces",
            "installed",
          ].includes(e.name)
        ) {
          continue;
        }
        // Also skip the `.git` directory inside marketplace checkouts.
        if (e.name === ".git") continue;
        await walk(p);
      } else if (e.isFile()) {
        if (
          e.name === ".credentials.json" ||
          e.name === ".claude.json" ||
          e.name === "known_marketplaces.json" ||
          e.name === "settings.local.json"
        ) continue;
        // Only inspect text-ish files.
        if (!/\.(json|md|sh|bash|zsh|js|mjs|cjs|ts|yaml|yml|toml|txt|conf)$/i.test(e.name)) continue;
        try {
          const s = await stat(p);
          if (s.size > 2 * 1024 * 1024) continue; // skip large files
          const text = await readFile(p, "utf8");
          if (looksLikeForeignAbsolutePath(text)) {
            // Documentation files are "soft" — warn, don't fail. They often
            // contain example or placeholder paths like /Users/me/...
            if (/\.md$/i.test(e.name)) soft.push(p);
            else hard.push(p);
          }
        } catch {
          // ignore unreadable
        }
      }
    }
  }
  await walk(dir);
  return { hard, soft };
}
