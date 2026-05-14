import { ensureDir, pathExists, readJson, writeJsonAtomic } from "./fs.ts";
import { lastActivePath, stateDir, syncStatePath } from "./paths.ts";

export interface LastActive {
  profile: string;
  at: string;
}

export interface SyncState {
  lastPushAt?: string;
  lastPullAt?: string;
}

export async function recordLastActive(profile: string): Promise<void> {
  await ensureDir(stateDir());
  const v: LastActive = { profile, at: new Date().toISOString() };
  await writeJsonAtomic(lastActivePath(), v);
}

export async function readLastActive(): Promise<LastActive | null> {
  if (!(await pathExists(lastActivePath()))) return null;
  try {
    return await readJson<LastActive>(lastActivePath());
  } catch {
    return null;
  }
}

export async function readSyncState(): Promise<SyncState> {
  if (!(await pathExists(syncStatePath()))) return {};
  try {
    return await readJson<SyncState>(syncStatePath());
  } catch {
    return {};
  }
}

export async function updateSyncState(patch: Partial<SyncState>): Promise<void> {
  await ensureDir(stateDir());
  const cur = await readSyncState();
  const next = { ...cur, ...patch };
  await writeJsonAtomic(syncStatePath(), next);
}
