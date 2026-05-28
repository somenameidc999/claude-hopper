import { join } from "node:path";
import { profileDir } from "./paths.ts";
import { pathExists, readJson, writeJsonAtomic } from "./fs.ts";

/**
 * Claude Code caches its server-fetched feature flags inside each config dir's
 * `.claude.json`. These keys hold that cache. They are per-account, per-machine
 * runtime state — hopper never syncs them; each profile fetches its own set on
 * launch (bucketed by the account it's signed in as).
 *
 * `cachedGrowthBookFeaturesAt` is the fetch timestamp. Claude only re-fetches
 * when it is absent or older than its TTL, so deleting it forces a refetch on
 * the profile's next full boot — which is how we refresh without copying one
 * account's flags onto another (that would surface features the account isn't
 * actually entitled to).
 */
export const FLAG_CACHE_KEYS = [
  "cachedGrowthBookFeatures",
  "cachedExperimentFeatures",
  "cachedGrowthBookFeaturesAt",
] as const;

export interface FlagSnapshot {
  /** Number of GrowthBook feature flags cached. */
  gb: number;
  /** Number of enabled A/B experiments cached. */
  exp: number;
  /** Fetch timestamp (epoch ms), or null if never fetched. */
  at: number | null;
}

function claudeJsonPath(profileName: string): string {
  return join(profileDir(profileName), ".claude.json");
}

/** Read the flag-cache counts for a profile. Missing file → zeroed snapshot. */
export async function readFlagSnapshot(profileName: string): Promise<FlagSnapshot> {
  const p = claudeJsonPath(profileName);
  if (!(await pathExists(p))) return { gb: 0, exp: 0, at: null };
  try {
    const d = await readJson<Record<string, unknown>>(p);
    const gb = d.cachedGrowthBookFeatures;
    const exp = d.cachedExperimentFeatures;
    return {
      gb: gb && typeof gb === "object" ? Object.keys(gb).length : 0,
      exp: Array.isArray(exp) ? exp.length : 0,
      at: typeof d.cachedGrowthBookFeaturesAt === "number" ? d.cachedGrowthBookFeaturesAt : null,
    };
  } catch {
    return { gb: 0, exp: 0, at: null };
  }
}

/**
 * Drop the flag-cache keys from a profile's `.claude.json` so its next full
 * boot re-fetches from the server. Preserves every other key. No-op (returns
 * false) if the file is absent or already has no cached flags.
 */
export async function invalidateFlagCache(profileName: string): Promise<boolean> {
  const p = claudeJsonPath(profileName);
  if (!(await pathExists(p))) return false;
  let d: Record<string, unknown>;
  try {
    d = await readJson<Record<string, unknown>>(p);
  } catch {
    return false;
  }
  let changed = false;
  for (const k of FLAG_CACHE_KEYS) {
    if (k in d) {
      delete d[k];
      changed = true;
    }
  }
  if (changed) await writeJsonAtomic(p, d);
  return changed;
}
