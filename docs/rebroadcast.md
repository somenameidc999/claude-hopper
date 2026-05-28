# Design sketch: `rebroadcast`

Status: proposal. Roadmap item ("A `rebroadcast` command for propagating changes across all profiles").

## Problem

Every profile is a full, standalone copy of a Claude Code config dir. That isolation is the whole point — separate accounts can't leak into each other. The cost is that **user-authored config doesn't propagate**: a skill, agent, or hook you add in `personal` never appears in `work`. Today the only fix is to copy by hand.

`rebroadcast` propagates the *shared, user-authored* parts of one profile to the others — and pointedly **not** the per-account or per-machine parts.

## What this is NOT

It is not flag propagation. Feature flags (`cachedGrowthBookFeatures`, `cachedExperimentFeatures` in `.claude.json`) are **account-specific server state**, bucketed by the signed-in identity. Copying one profile's flags onto another would surface features the other account isn't entitled to, and would be overwritten on its next launch anyway. Flag freshness is handled separately by `refresh-flags` (invalidate + refetch per account). `rebroadcast` must never touch `.claude.json`.

## The broadcast set

Reuse the exclusion lists already in `src/profile.ts` (`EXCLUDED_PREFIXES`, `EXCLUDED_BASENAMES`) as the hard floor — nothing in them is ever eligible. On top of that, classify the remaining config into three propagation tiers:

| Tier | Paths | Default | Why |
| --- | --- | --- | --- |
| **Asset dirs** | `agents/`, `skills/`, `commands/`, `hooks/` | propagate | Pure user-authored content; portable; the main reason this command exists. |
| **Single-file config** | `CLAUDE.md`, `statusline.sh`, `keybindings.json` | opt-in | Often shared, but a profile may deliberately differ. Overwrite is destructive, so require `--include`. |
| **Structured config** | `settings.json`, `mcp.json` | opt-in + merge | Mix shared keys with account/machine-specific ones (model, permissions, MCP tokens/paths). Never blind-overwrite. |

`settings.json` / `mcp.json` propagation, when requested, is a **key-level deep merge** with a denylist (e.g. never copy `permissions`, `env`, anything that looks account- or path-bound), not a file copy. Default: skip them entirely.

## CLI shape

```
claude-hopper rebroadcast --from <profile> [--to <a,b> | --all]
                          [--only agents,skills,...] [--except hooks]
                          [--include claude-md,statusline]   # opt-in tiers
                          [--mode overlay|mirror]
                          [--dry-run] [--yes] [--json]
```

- `--from` is required; the source of truth for this run.
- `--to` / `--all` select targets (never includes `--from`). Prefix-matching via `resolveProfileName`, same as `run`/`doctor`.
- `--only` / `--except` filter the asset-dir set.
- `--include` opts single-file / structured config into the run.
- `--mode overlay` (default): add new files, overwrite changed ones, **leave target-only files alone**. `--mode mirror`: make the target's set byte-identical, **deleting** files not in the source. Mirror is destructive and should print every deletion.

## Execution: plan, then apply

Two phases, mirroring how `doctor`/`sync` already separate diagnosis from action.

1. **Plan.** Walk the source's broadcast set; for each target, diff against it (content hash per file) and produce a list of `add` / `update` / `delete` (mirror only) / `skip-identical` entries. Render it like the doctor report, grouped by target profile.
2. **Apply.** Only after confirmation (or `--yes`). Reuse `copyTree` from `src/fs.ts` with an *include* filter (the inverse of its current exclude filter — small addition to `CopyOptions`). Writes go through the existing atomic helpers. Deletes (mirror) are explicit `rm`s of planned paths only.

`--dry-run` stops after Plan. Default (no `--dry-run`, no `--yes`) prints the plan and prompts.

## Safety rails

- **Doctor-gate the result.** After apply, run the existing foreign-absolute-path scan against each touched target (the `scanForForeignAbsolute` logic) so a broadcast can't smuggle a `/Users/<someone>/…` path into another profile. Fail loud if it does.
- **Never cross the secret floor.** `.credentials.json`, `.claude.json`, `settings.local.json`, `known_marketplaces.json`, and every `EXCLUDED_PREFIXES` dir are unconditionally skipped, even if a user `--only`s into them.
- **Idempotent.** Re-running with no source changes produces an all-`skip-identical` plan and writes nothing.
- **Local-only.** `rebroadcast` never touches git. It composes with sync: `rebroadcast` to spread config across profiles on this machine, then `sync push` to ship it to other machines.

## Why overlay is the default

Mirror (delete target-only files) is the kind of thing that's right once and catastrophic the second time, when you've forgotten a target had local-only skills. Overlay is the safe additive default; mirror is available for the "make these truly identical" case, with every deletion printed.

## Open questions

- Should `--from canonical` (i.e. `~/.claude`) be allowed, to seed all profiles from the base install? Leaning yes — it's the natural "I set up my real config, now fan it out" flow, and `seedProfile` already special-cases `canonical`.
- Do we record last-broadcast provenance (source + time) per profile, à la `recordLastActive`, so `doctor` can flag drift? Probably a v2.
- Merge policy for `settings.json` deserves its own allowlist spec before building — easy to get subtly wrong.
