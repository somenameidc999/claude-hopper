# claude-hopper

Manage multiple isolated Claude Code profiles — personal, work, contractor, whatever — and sync the non-secret parts across machines via git.

Each profile is a fully independent copy of Claude Code config. Different OAuth, different settings, different agents, different skills. One alias per profile (`claude-personal`, `claude-work`, ...) drops you into the right one.

---

## Quickstart

```bash
npm install -g claude-hopper

# On your first machine:
claude-hopper init --remote git@github.com:you/claude-hopper-sync.git
claude-hopper profile add personal --seed canonical   # copy from ~/.claude
claude-hopper profile add work --seed empty
claude-hopper sync push

# On a fresh second machine:
claude-hopper init --remote git@github.com:you/claude-hopper-sync.git
# Profiles are now materialized. Authenticate each one:
claude-personal              # OAuth in browser
claude-work                 # OAuth in browser (sign out of claude.ai first or use incognito)
```

`claude-hopper` and `chp` are both wired as bin names — use whichever you prefer.

---

## How profiles work

Every profile lives at `~/.claude-hopper/profiles/<name>/` and is a complete, standalone Claude Code config dir:

```
~/.claude-hopper/profiles/work/
  settings.json
  CLAUDE.md
  agents/
  skills/
  hooks/
  plugins/
  keybindings.json
  statusline.sh
  mcp.json
  .credentials.json     ← OAuth token, never synced
  projects/             ← session history, never synced
  todos/                ← never synced
```

The `claude-<name>` alias just sets `CLAUDE_CONFIG_DIR` and execs Claude Code. There's no wrapper, no daemon, no magic.

**Important trade-off:** because each profile is a full copy, **changes to one profile do not propagate to the others.** If you tweak a skill or add a hook in `personal`, the others won't see it. This is intentional: full isolation is what makes profiles safe across separate Anthropic accounts. A future `rebroadcast` command may help propagate common config; for now, copy manually.

---

## Cross-machine sync

Sync uses your own git remote (GitHub, GitLab, self-hosted — whatever).

**What's synced:** `config.json`, `profiles/*/settings.json`, `profiles/*/CLAUDE.md`, `profiles/*/agents/`, `profiles/*/skills/`, `profiles/*/hooks/`, `profiles/*/plugins/`, `profiles/*/keybindings.json`, `profiles/*/statusline.sh`, `profiles/*/mcp.json`.

**What's NOT synced:**

| Path | Why |
| --- | --- |
| `.credentials.json` | OAuth token — secret |
| `.claude.json` | Claude Code's per-machine runtime state |
| `projects/`, `todos/`, `session-env/` | Local session history |
| `statsig/`, `cache/`, `locks/`, `shell-snapshots/`, `*.log` | Per-machine state |

You'll need to authenticate each profile on each machine — `claude-hopper` does not handle OAuth.

Sync is **explicit**: `claude-hopper sync push`, `claude-hopper sync pull`, `claude-hopper sync status`. Pull is fast-forward only; if histories diverge, resolve manually with `cd ~/.claude-hopper && git pull`.

---

## Command reference

| Command | What it does |
| --- | --- |
| `claude-hopper init [--remote <url>] [--no-sync] [--yes]` | Bootstrap on this machine. Optionally clones from a remote. |
| `claude-hopper profile add <name> [--seed canonical\|empty\|clone:<name>]` | Create a new profile. |
| `claude-hopper profile list` | List profiles with health/auth status. |
| `claude-hopper profile remove <name> [--keep-files]` | Remove a profile (and its alias). |
| `claude-hopper profile clone <source> <new>` | Duplicate an existing profile, minus secrets. |
| `claude-hopper profile alias-install <name>` | (Re)install the shell alias for a profile. |
| `claude-hopper profile alias-remove <name>` | Remove just the shell alias. |
| `claude-hopper run <name> [...args]` | Launch Claude Code with the profile (or use the `claude-<name>` alias). |
| `claude-hopper doctor [--repair] [--profile <name>]` | Health-check profiles. `--repair` fixes what it can. |
| `claude-hopper sync push [--message <m>] [--force]` | Stage, commit, push. Doctor-gated unless `--force`. |
| `claude-hopper sync pull [--discard] [--no-repair]` | Fast-forward pull, then `doctor --repair` to fix local aliases. |
| `claude-hopper sync status` | Show ahead/behind, uncommitted files, last push/pull. |
| `claude-hopper uninstall` | Remove `~/.claude-hopper` and all aliases. Leaves `~/.claude` untouched. |

Most commands accept `--json` for machine-readable output. `run` accepts any args and passes them through to `claude` (e.g. `claude-hopper run work --resume`).

Profile-name prefix matching is supported: `claude-hopper run l` is fine if it's unambiguous.

---

## Troubleshooting

**`doctor` says "Directory exists ✗ Missing"** — run `claude-hopper doctor --repair` to recreate empty profile dirs (Claude Code will populate them on next launch).

**`doctor` says "Alias in ~/.zshrc ✗ missing"** — `claude-hopper profile alias-install <name>`, then reload your shell.

**`doctor` says "No foreign absolute paths ✗"** — one of your tracked files contains a path like `/Users/someone-else/...`. Open the listed file and replace it with a portable reference (e.g. `~/...` or a project-relative path). This is the #1 jean-claude failure mode the doctor is built to catch.

**`sync pull` says "Pull failed (not a fast-forward)"** — histories diverged. `cd ~/.claude-hopper && git pull` (or rebase/merge), then re-run `claude-hopper doctor --repair`.

**OAuth keeps grabbing the wrong account** — sign out of claude.ai in your browser first, or use an incognito window when authenticating a fresh profile.

**`run` says "Could not find the `claude` executable"** — install [Claude Code](https://claude.com/claude-code), or set `CLAUDE_HOPPER_CLAUDE_BIN=/path/to/claude` if it's at a non-standard location.

**Want a stack trace?** Set `CLAUDE_HOPPER_DEBUG=1`.

---

## Comparison to alternatives

**[jean-claude](https://github.com/anthropics/jean-claude)** stores absolute paths in its registry and pollutes `~/.claude/` with metadata, both of which break cross-machine sync. claude-hopper was built specifically to not do those things: every path is `~`-prefixed or profile-relative, and hopper data lives at `~/.claude-hopper/`, never inside `~/.claude/`. If you've been bitten by jean-claude on a second machine, that's the bug we don't repeat.

**[aimux](https://github.com/aimux/aimux)** is broader (multi-tool: Claude, Codex, Gemini). claude-hopper is Claude-only and treats that as a feature — fewer moving parts, no abstractions over per-tool quirks.

**[claude-swap](https://github.com/anthropics/claude-swap)** focuses on quota juggling between accounts with usage tracking. claude-hopper doesn't track usage; it's about long-lived, fully-isolated identities. If you want a usage dashboard, use claude-swap; if you want stable per-identity config that syncs across machines, use claude-hopper.

---

## How it works (one screen)

1. `claude-hopper init` creates `~/.claude-hopper/` (and optionally git-inits it with your remote).
2. `profile add <name>` makes `~/.claude-hopper/profiles/<name>/`, seeds it from your chosen source (`~/.claude`, another profile, or empty), and writes a marker-fenced alias into your shell rc file:
   ```bash
   # >>> claude-hopper: work >>>
   alias claude-work='CLAUDE_CONFIG_DIR="$HOME/.claude-hopper/profiles/work" command claude'
   # <<< claude-hopper: work <<<
   ```
3. The alias uses `$HOME`, never a hard-coded absolute path. The marker comments let `alias-remove` and `uninstall` clean up cleanly years later.
4. `sync push` commits everything except secrets/per-machine-state (governed by `.gitignore`) and pushes. `sync pull` fast-forwards and then runs `doctor --repair` to (re)install aliases for any profiles that appeared in the pull.

The whole thing is a few hundred lines of TypeScript. No daemons, no caches, no background processes.

---

## Roadmap

Out of scope for v1:

- Codex CLI and Gemini CLI support
- Per-machine config overrides
- A `rebroadcast` command for propagating changes across all profiles
- Usage tracking (5h / 7d limits per profile)
- Conflict resolution beyond fast-forward
- TUI mode

---

## License

MIT
