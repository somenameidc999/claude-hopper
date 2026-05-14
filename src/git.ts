import { spawn } from "node:child_process";
import { hopperDir } from "./paths.ts";
import { pathExists } from "./fs.ts";
import { join } from "node:path";
import { HopperError } from "./errors.ts";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  cwd?: string;
  /** If true, do not throw on non-zero exit. */
  allowFail?: boolean;
  input?: string;
}

export async function git(args: string[], opts: GitOptions = {}): Promise<GitResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd ?? hopperDir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Don't leak per-user git config surprises into our commit messages.
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      const result: GitResult = { code: code ?? 0, stdout, stderr };
      if (code !== 0 && !opts.allowFail) {
        reject(
          new HopperError(
            `git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`,
            "Inspect the error above. You can also `cd ~/.claude-hopper && git ...` to investigate directly.",
            "GIT_FAIL",
          ),
        );
        return;
      }
      resolve(result);
    });
    if (opts.input) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export async function isHopperDirGitRepo(): Promise<boolean> {
  return pathExists(join(hopperDir(), ".git"));
}

export async function gitInstalled(): Promise<boolean> {
  try {
    const r = await git(["--version"], { cwd: process.cwd(), allowFail: true });
    return r.code === 0;
  } catch {
    return false;
  }
}
