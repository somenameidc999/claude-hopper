export const GITIGNORE_TEMPLATE = `# Per-profile auth and per-machine state — NEVER sync these.
profiles/*/.credentials.json
profiles/*/.claude.json
profiles/*/projects/
profiles/*/todos/
profiles/*/session-env/
profiles/*/statsig/
profiles/*/cache/
profiles/*/locks/
profiles/*/*.log
profiles/*/shell-snapshots/

# Plugin runtime state: Claude Code re-fetches marketplaces on demand and
# the install-location paths are machine-specific.
profiles/*/plugins/known_marketplaces.json
profiles/*/plugins/marketplaces/
profiles/*/plugins/installed/

# Per-machine permission overrides and clipboard cache.
profiles/*/settings.local.json
profiles/*/paste-cache/

# Legacy jean-claude metadata that may sneak in via --seed canonical.
profiles/*/.jean-claude/

# Defensive: any per-machine hopper state that ever lands inside the dir.
.last-active.json
.sync-state.json
`;

export const SYNC_README_TEMPLATE = `# claude-hopper sync repo

This repository is managed by [\`claude-hopper\`](https://www.npmjs.com/package/claude-hopper).
It holds the shareable parts of multiple Claude Code profiles so they can be
synced across machines.

## What's in here

- \`config.json\` — the profile registry (no usernames, hostnames, or absolute paths).
- \`profiles/<name>/\` — one directory per profile, containing Claude Code
  config (settings.json, CLAUDE.md, agents/, skills/, hooks/, plugins/,
  keybindings.json, statusline.sh, mcp.json, etc).

## What's intentionally NOT in here

- \`.credentials.json\` (auth tokens — secret, never synced)
- \`.claude.json\` (Claude Code runtime state — machine-specific)
- \`projects/\`, \`todos/\`, \`session-env/\` (per-machine session history)
- \`statsig/\`, \`cache/\`, \`locks/\`, \`*.log\`, \`shell-snapshots/\`

These are excluded by the \`.gitignore\` at the root of this repo. After
syncing on a new machine, you'll need to OAuth into each profile by running
\`claude-<name>\` (or \`claude-hopper run <name>\`).

## Bootstrapping a new machine

\`\`\`
npm install -g claude-hopper
claude-hopper init --remote <this-repo-url>
\`\`\`

That clones this repo into \`~/.claude-hopper\`, registers shell aliases for
every profile, and reports which profiles still need auth.
`;
