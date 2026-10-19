// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { applyRuntimeJourneyFixture } from './runtime-journey-local-fixture';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

it('rejects non-owned sockets before any fixture execution', () => {
  expect(() =>
    applyRuntimeJourneyFixture({
      socketDirectory: '/tmp/other/socket',
      sequence: 701,
      action: 'credit',
    })
  ).toThrow('Owned synthetic fixture required');
  expect(execFileSync).not.toHaveBeenCalled();
});

it('uses only fixed local SQL fixture with an explicit test-only child environment', () => {
  applyRuntimeJourneyFixture({
    socketDirectory: '/tmp/baci-piggyvest-runtime.synthetic/socket',
    sequence: 701,
    action: 'credit',
  });
  expect(execFileSync).toHaveBeenCalledWith(
    '/opt/homebrew/opt/postgresql@18/bin/psql',
    expect.arrayContaining([
      '-h',
      '/tmp/baci-piggyvest-runtime.synthetic/socket',
      'sequence=701',
    ]),
    { env: { NODE_ENV: 'test' }, stdio: 'pipe', timeout: 75000 }
  );
});
