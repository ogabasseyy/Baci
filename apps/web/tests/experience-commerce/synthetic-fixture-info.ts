import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export function assertSyntheticFixtureInfoPath(
  path: string | undefined
): asserts path is string {
  const name = path ? basename(path) : '';
  if (
    !/^baci-synthetic-[0-9a-f-]+\.json$/.test(name) ||
    path !== join(homedir(), '.codex', 'tmp', name)
  )
    throw Error('INVALID_SYNTHETIC_FIXTURE_INFO_PATH');
}

/** Optional operator-owned metadata for the disposable local fixture only. */
export function createSyntheticFixtureInfo(
  path: string,
  value: { url: string; anonKey: string }
) {
  assertSyntheticFixtureInfoPath(path);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    rmSync(path, { force: true });
  };
}
