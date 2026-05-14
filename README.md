# claude-hopper

[![npm version](https://img.shields.io/npm/v/claude-hopper.svg)](https://www.npmjs.com/package/claude-hopper)
[![npm downloads](https://img.shields.io/npm/dm/claude-hopper.svg)](https://www.npmjs.com/package/claude-hopper)
[![license](https://img.shields.io/npm/l/claude-hopper.svg)](./LICENSE)

Manage multiple isolated Claude Code profiles — personal, work, contractor, whatever — and sync the non-secret parts across machines via git.

Each profile is a fully independent copy of Claude Code config. Different OAuth, different settings, different agents, different skills. One alias per profile (`claude-personal`, `claude-work`, ...) drops you into the right one.

```bash
npm install -g claude-hopper
claude-hopper init --remote https://github.com/<you>/<sync-repo>.git
claude-hopper profile add personal --seed canonical
source ~/.zshrc && claude-personal
```

---

## Prerequisites

Before installing, make sure these are available on each machine you'll use:

| Tool | Why | Install |
| --- | --- | --- |
| Node.js ≥ 20 | Runtime for the CLI | `brew install node` |
| `git` | Sync transport | usually pre-installed; `brew install git` |
| [GitHub CLI](https://cli.github.com) (`gh`) | Easiest way to auth git over HTTPS | `brew install gh` |
| [Claude Code](https://claude.com/claude-code) | The thing being managed | follow official install instructions |
| A private git repo for sync | Holds your synced profile config | create an **empty** repo on GitHub/GitLab — don't add a README, .gitignore, or LICENSE; `claude-hopper` will populate it |

Authenticate `git` for the sync remote (one-time per machine):

```bash
gh auth login           # GitHub.com → HTTPS → "Login with a web browser"
```

This sets up a credential helper so subsequent `git clone`/`push`/`pull` against private repos works without prompts. If you prefer SSH, set up an SSH key and add it to GitHub instead — `claude-hopper` will use whichever URL form you pass to `--remote`.

---

## Install

```bash
npm install -g claude-hopper
```

Both `claude-hopper` and the short alias `chp` land on your PATH.

> **Building from source** (only needed if you're contributing): clone the repo, `bun install`, `bun run build`, `npm i -g .`.

---

## Quickstart — first machine

```bash
# 1. Bootstrap hopper, pointing at your (empty) sync repo
claude-hopper init --remote https://github.com/<you>/<sync-repo>.git

# 2. Add profiles (one per Anthropic identity you want to keep separate)
claude-hopper profile add personal --seed canonical    # copy from ~/.claude
claude-hopper profile add work --seed empty            # start fresh

# 3. Reload your shell so the new aliases work
source ~/.zshrc

# 4. Sign in to each profile
#    IMPORTANT: sign out of claude.ai in your browser between accounts, or
#    use a separate browser / incognito window — otherwise OAuth will
#    auto-authorize whichever account is currently signed in.
claude-personal       # OAuth, then quit
claude-work

# 5. Push the synced parts to your remote
claude-hopper sync push
```

---

## Quickstart — second (or third, or N-th) machine

After repeating the **Prerequisites** and **Install** sections on the new machine:

```bash
# 1. Bootstrap — clones the sync repo into ~/.claude-hopper/
#    and installs shell aliases for every profile.
claude-hopper init --remote https://github.com/<you>/<sync-repo>.git

# 2. Reload your shell
source ~/.zshrc

# 3. Verify
claude-hopper profile list      # all profiles present, status: needs-auth
claude-hopper doctor            # all ✓ except auth warnings

# 4. Authenticate each profile on this machine
#    (same browser-session gotcha as above — be careful)
claude-personal
claude-work
```

That's it. From here, ongoing sync is `claude-hopper sync push` on the machine that changed something, `claude-hopper sync pull` on the others.

---

## How profiles work

Every profile lives at `~/.claude-hopper/profiles/<name>/` and is a complete, standalone Claude Code config dir:

```
~/.claude-hopper/profiles/personal/
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

**What's synced:** `config.json`, `profiles/*/settings.json`, `profiles/*/CLAUDE.md`, `profiles/*/agents/`, `profiles/*/skills/`, `profiles/*/hooks/`, `profiles/*/plugins/` (config only, not the marketplace checkouts), `profiles/*/keybindings.json`, `profiles/*/statusline.sh`, `profiles/*/mcp.json`.

**What's NOT synced:**

| Path | Why |
| --- | --- |
| `.credentials.json` | OAuth token — secret |
| `.claude.json` | Claude Code's per-machine runtime state |
| `settings.local.json` | Per-machine permission overrides |
| `projects/`, `todos/`, `session-env/` | Local session history |
| `plugins/known_marketplaces.json`, `plugins/marketplaces/`, `plugins/installed/` | Per-machine plugin install paths |
| `paste-cache/` | Clipboard cache |
| `statsig/`, `cache/`, `locks/`, `shell-snapshots/`, `*.log` | Per-machine runtime state |

You'll need to authenticate each profile on each machine — `claude-hopper` does not handle OAuth.

Sync is **explicit**: `claude-hopper sync push`, `claude-hopper sync pull`, `claude-hopper sync status`. Pull is fast-forward only; if histories diverge, resolve manually with `cd ~/.claude-hopper && git pull`.

---

## Command reference

| Command | What it does |
| --- | --- |
| `claude-hopper init [--remote <url>] [--no-sync] [--yes]` | Bootstrap on this machine. With `--remote`, clones an existing sync repo or initializes a new one. |
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

Most commands accept `--json` for machine-readable output. `run` accepts any args and passes them through to `claude` (e.g. `claude-hopper run personal --resume`).

Profile-name prefix matching is supported: `claude-hopper run p` is fine if it's unambiguous.

---

## Troubleshooting

**`init --remote ...` errors with `Cannot reach git remote: ... Permission denied`** — auth isn't set up for that remote. Easiest fix: `gh auth login` and use the `https://` form of the URL. For SSH URLs, set up an SSH key (`ssh-keygen -t ed25519` then add it to GitHub via `gh ssh-key add ~/.ssh/id_ed25519.pub` or the web UI).

**`profile list` shows `No profiles yet` after `init --remote`** — the clone didn't happen. As of v0.1.1 this should now fail loudly during `init` (see above), but if you're on an older build, `claude-hopper uninstall && claude-hopper init --remote <url>` after fixing auth will get you sorted.

**`doctor` says `Directory exists ✗ Missing`** — run `claude-hopper doctor --repair` to recreate empty profile dirs (Claude Code will populate them on next launch).

**`doctor` says `Alias in ~/.zshrc ✗ missing`** — `claude-hopper profile alias-install <name>`, then `source ~/.zshrc`.

**`doctor` shows `No foreign absolute paths (config/code) ✗`** — one of your tracked config files contains a path like `/Users/someone-else/...`. Open the listed file and replace with a portable reference (e.g. `~/...`). This is the single most common cross-machine sync failure mode, and the doctor is built to catch it before the bad data hits your remote.

**`doctor` shows `No foreign absolute paths (docs) ⚠`** — a markdown file in a skill contains an example path like `/Users/me/...`. This is a warning, not a failure; push will still succeed. If you want it clean, edit the doc to use a placeholder like `<your-home>/...`.

**Aliases don't exist after `init` or `profile add`** — you need to `source ~/.zshrc` (or `~/.bashrc`, `~/.config/fish/config.fish`) to pick them up in the current shell. New terminals will pick them up automatically.

**`sync pull` says `Pull failed (not a fast-forward)`** — histories diverged. `cd ~/.claude-hopper && git pull` (or rebase/merge), then re-run `claude-hopper doctor --repair`.

**OAuth keeps grabbing the wrong account** — sign out of claude.ai in your browser first, or use an incognito window when authenticating a fresh profile. The `claude` CLI uses your browser's active session.

**`run` says `Could not find the claude executable`** — install [Claude Code](https://claude.com/claude-code), or set `CLAUDE_HOPPER_CLAUDE_BIN=/path/to/claude` if it's at a non-standard location.

**Want a stack trace?** Set `CLAUDE_HOPPER_DEBUG=1` and re-run.

---

## Comparison to alternatives

**[jean-claude](https://github.com/anthropics/jean-claude)** stores absolute paths in its registry and pollutes `~/.claude/` with metadata, both of which break cross-machine sync. claude-hopper was built specifically to not do those things: every path is `~`-prefixed or profile-relative, and hopper data lives at `~/.claude-hopper/`, never inside `~/.claude/`. If you've been bitten by jean-claude on a second machine, that's the bug we don't repeat.

**[aimux](https://github.com/aimux/aimux)** is broader (multi-tool: Claude, Codex, Gemini). claude-hopper is Claude-only and treats that as a feature — fewer moving parts, no abstractions over per-tool quirks.

**[claude-swap](https://github.com/anthropics/claude-swap)** focuses on quota juggling between accounts with usage tracking. claude-hopper doesn't track usage; it's about long-lived, fully-isolated identities. If you want a usage dashboard, use claude-swap; if you want stable per-identity config that syncs across machines, use claude-hopper.

---

## How it works (one screen)

1. `claude-hopper init --remote <url>` creates `~/.claude-hopper/`. If the remote already has content, it clones into the hopper dir (so all profiles materialize immediately). If the remote is empty, it `git init`s and adds origin. Either way, it detects your shell, writes the `.gitignore` and sync-repo README templates, and runs `doctor --repair` to install aliases for any profiles that came from the clone.
2. `profile add <name>` makes `~/.claude-hopper/profiles/<name>/`, seeds it from your chosen source (`~/.claude`, another profile, or empty), and writes a marker-fenced alias into your shell rc file:
   ```bash
   # >>> claude-hopper: personal >>>
   alias claude-personal='CLAUDE_CONFIG_DIR="$HOME/.claude-hopper/profiles/personal" command claude'
   # <<< claude-hopper: personal <<<
   ```
3. The alias uses `$HOME`, never a hard-coded absolute path. The marker comments let `alias-remove` and `uninstall` clean up cleanly years later.
4. `sync push` commits everything except secrets and per-machine state (see [the exclusion list](#cross-machine-sync)) and pushes. `sync pull` fast-forwards and then runs `doctor --repair` to (re)install aliases for any profiles that appeared in the pull.

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
