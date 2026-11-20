import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('./build-brilstash-catalogue.ts', import.meta.url));
const fixture = fileURLToPath(new URL('../../../../docs/partners/brilstash/pilot/baseline.json', import.meta.url));

it.each([
  [[], 'BrilStash staging requires --apply'],
  [['--apply'], 'Invalid BrilStash builder input'],
] as const)('validates arguments before database configuration with flags %j', (flags, error) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, fixture, ...flags], {
    encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 20000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe(error);
}, 25000);
