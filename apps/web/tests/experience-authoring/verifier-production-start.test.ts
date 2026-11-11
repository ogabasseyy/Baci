import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ parse: vi.fn(), service: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../tools/experience-verifier/production-config', () => ({
  parseVerifierProductionConfig: f.parse,
}));
vi.mock('../../tools/experience-verifier/service', () => ({
  startVerifierService: f.service,
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
