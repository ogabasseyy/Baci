import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  parse: vi.fn(),
  service: vi.fn(),
  observer: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../tools/experience-verifier/production-config', () => ({
  parseVerifierProductionConfig: f.parse,
}));
vi.mock('../../tools/experience-verifier/service', () => ({
  startVerifierService: f.service,
}));
vi.mock('../../tools/experience-verifier/public-verification-local', () => ({
  createLocalPinnedPublicObserver: f.observer,
}));

import { startProductionVerifier } from '../../tools/experience-verifier/production-start';

it('opens a TLS-verified restricted session and closes it after the service', async () => {
  const calls: string[] = [];
  const pool = {
    end: vi.fn(async () => {
      calls.push('pool');
    }),
  };
  const close = vi.fn(async () => {
    calls.push('service');
  });
  f.parse.mockReturnValueOnce({ databaseUrl: 'synthetic', port: 1234 });
  f.service.mockResolvedValueOnce({ close });
  const createPool = vi.fn(() => pool);
  const running = await startProductionVerifier({}, { createPool } as never);
  expect(createPool).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: { rejectUnauthorized: true },
      options: '-c role=baci_experience_verifier',
      max: 4,
    })
  );
  await running.close();
  await running.close();
  expect(calls).toEqual(['service', 'pool']);
});
it('closes the pool and redacts service startup failures', async () => {
  const pool = { end: vi.fn(async () => {}) };
  f.parse.mockReturnValueOnce({ databaseUrl: 'synthetic' });
  f.service.mockRejectedValueOnce(Error('private secret'));
  await expect(
    startProductionVerifier({}, { createPool: () => pool } as never)
  ).rejects.toThrow('VERIFIER_STARTUP_FAILED');
  expect(pool.end).toHaveBeenCalledOnce();
});
it('preflights the explicit co-located observer before binding the service', async () => {
  const pool = { end: vi.fn(async () => {}) };
  const observe = vi.fn();
  const config = {
    databaseUrl: 'synthetic',
    publicObserver: 'co-located',
    supabase: { url: 'https://project.supabase.co' },
    runner: { toolchainDigest: 'a'.repeat(64) },
    rootDomain: 'merchant.test',
  };
  f.parse.mockReturnValueOnce(config);
  f.observer.mockResolvedValueOnce(observe);
  f.service.mockResolvedValueOnce({ close: vi.fn() });
  await startProductionVerifier({}, { createPool: () => pool } as never);
  expect(f.observer).toHaveBeenCalledWith({
    productOrigin: config.supabase.url,
    toolchainDigest: config.runner.toolchainDigest,
  });
  expect(f.service).toHaveBeenLastCalledWith(
    expect.objectContaining({
      publicVerification: { rootDomain: config.rootDomain, observe },
    })
  );
});

it('does not bind the listener when co-located preflight fails', async () => {
  const pool = { end: vi.fn(async () => {}) };
  f.parse.mockReturnValueOnce({
    databaseUrl: 'synthetic',
    publicObserver: 'co-located',
    supabase: { url: 'https://project.supabase.co' },
    runner: { toolchainDigest: 'a'.repeat(64) },
  });
  f.observer.mockRejectedValueOnce(Error('preflight secret'));
  f.service.mockClear();
  await expect(
    startProductionVerifier({}, { createPool: () => pool } as never)
  ).rejects.toThrow('VERIFIER_STARTUP_FAILED');
  expect(f.service).not.toHaveBeenCalled();
  expect(pool.end).toHaveBeenCalledOnce();
});
