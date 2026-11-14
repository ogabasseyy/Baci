import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { captureOrbitSnapshot } from './orbit-snapshot.test-support';

it.skipIf(process.env.BACI_LOCAL_ORBIT_SNAPSHOT_TEST !== '1')(
  'captures the generated Orbit page and completes its synthetic cart review',
  async () => {
    const path = process.env.BACI_LOCAL_FIXTURE_INFO;
    if (
      !path ||
      !/^\/Users\/mac\/\.codex\/tmp\/baci-synthetic-[0-9a-f-]+\.json$/.test(
        path
      )
    )
      throw Error('INVALID_FIXTURE');
    const info: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !info ||
      typeof info !== 'object' ||
      !('url' in info) ||
      typeof info.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url)
    )
      throw Error('INVALID_FIXTURE');
    const snapshot = await captureOrbitSnapshot(info.url);
    expect(Object.keys(snapshot.resources).length).toBeGreaterThan(5);
  },
  180000
);
