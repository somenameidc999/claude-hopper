import { loadConfig, resolveProfileName } from "../config.ts";
import { runProfileAdd } from "./profile-add.ts";

export interface CloneFlags {
  yes?: boolean;
  json?: boolean;
  noAlias?: boolean;
}

export async function runProfileClone(
  source: string,
  newName: string,
  flags: CloneFlags,
): Promise<void> {
  const cfg = await loadConfig();
  const src = resolveProfileName(cfg, source);
  await runProfileAdd(newName, {
    seed: `clone:${src.name}`,
    yes: flags.yes,
    json: flags.json,
    noAlias: flags.noAlias,
  });
}
