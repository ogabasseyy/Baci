import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivationConfigFixture } from './prefunded-card-activation-config.test-support';
import { PrefundedCardPostgresFailure } from './prefunded-card-postgres-failure';
import { verifyPrefundedCardRuntimeReadiness } from './prefunded-card-runtime-readiness';

const mocks = vi.hoisted(() => ({ factory: vi.fn(), execute: vi.fn() }));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: mocks.factory,
}));

const now = new Date('2026-09-27T12:00:00Z');

describe('restricted staging runtime readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.factory.mockReturnValue(mocks.execute);
    mocks.execute.mockResolvedValue({ rows: [{ result: true }] });
  });

  it('checks all three role profiles with only the connection-ready SELECT', async () => {
    const result = await verifyPrefundedCardRuntimeReadiness(
      createActivationConfigFixture(),
      now
    );
    expect(result).toEqual({
      status: 'restricted-tls-ready',
      profiles: ['worker', 'authorizer', 'evidence'],
      readOnly: true,
      cardPaymentsEnabled: false,
    });
    expect(mocks.factory.mock.calls.map(([config]) => config.profile)).toEqual([
      'worker',
      'authorizer',
      'evidence',
    ]);
    expect(mocks.execute.mock.calls).toEqual(
      Array.from({ length: 3 }, () => ['SELECT true AS result', []])
    );
  });

  it('accepts a coherent October 6 lease without changing readiness authority', async () => {
    const renewed = JSON.parse(
      JSON.stringify(createActivationConfigFixture()).replaceAll(
        '2026-09-29T15:59:10Z',
        '2026-10-06T15:59:10Z'
      )
    );
    await expect(
      verifyPrefundedCardRuntimeReadiness(
        renewed,
        new Date('2026-10-06T15:59:09Z')
      )
    ).resolves.toMatchObject({
      readOnly: true,
      cardPaymentsEnabled: false,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it('does not contact the database for inconsistent or expired configuration', async () => {
    const configuration = createActivationConfigFixture();
    configuration.expected.database = 'wrong';
    await expect(
      verifyPrefundedCardRuntimeReadiness(configuration, now)
    ).rejects.toThrow('Runtime configuration refused');
    await expect(
      verifyPrefundedCardRuntimeReadiness(
        createActivationConfigFixture(),
        new Date('2026-09-29T15:59:10Z')
      )
    ).rejects.toThrow('Runtime configuration refused');
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('stops and redacts database failure without reporting readiness', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('password=private-value'));
    await expect(
      verifyPrefundedCardRuntimeReadiness(createActivationConfigFixture(), now)
    ).rejects.toThrow('Restricted runtime connection refused');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves only safe executor diagnostics and discards arbitrary error causes', async () => {
    const privateError = Object.assign(new Error('private-secret'), {
      code: '28P01',
    });
    const safeError = new PrefundedCardPostgresFailure(
      'authorizer',
      'connect',
      privateError
    );
    mocks.execute.mockRejectedValueOnce(safeError);
    await expect(
      verifyPrefundedCardRuntimeReadiness(createActivationConfigFixture(), now)
    ).rejects.toMatchObject({ cause: safeError });
    mocks.execute.mockRejectedValueOnce(privateError);
    const failure = await verifyPrefundedCardRuntimeReadiness(
      createActivationConfigFixture(),
      now
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: 'Restricted runtime connection refused',
      cause: expect.objectContaining({
        diagnostic: {
          profile: 'worker',
          phase: 'executor-initialization',
          code: 'unclassified',
        },
      }),
    });
    expect(JSON.stringify(failure)).not.toContain('private-secret');
  });

  it('refuses missing, false, or unexpected readiness rows', async () => {
    for (const rows of [
      [],
      [{ result: false }],
      [{ result: true }, { result: true }],
    ]) {
      mocks.execute.mockResolvedValueOnce({ rows });
      await expect(
        verifyPrefundedCardRuntimeReadiness(
          createActivationConfigFixture(),
          now
        )
      ).rejects.toThrow('Restricted runtime connection refused');
    }
  });
});
