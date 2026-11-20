import { rmSync, writeFileSync } from 'node:fs';

/** Optional operator-owned metadata for the disposable local fixture only. */
export function createSyntheticFixtureInfo(
  path: string,
  value: { url: string; anonKey: string }
) {
  if (
    !/^\/Users\/mac\/\.codex\/tmp\/baci-synthetic-[0-9a-f-]+\.json$/.test(path)
  )
    throw Error('INVALID_SYNTHETIC_FIXTURE_INFO_PATH');
  writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    rmSync(path, { force: true });
  };
}
