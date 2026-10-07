import { describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutRecoveryComposition } from './prefunded-card-checkout-recovery-composition';
import { createPrefundedCardCheckoutRecoveryRunner } from './prefunded-card-checkout-recovery-runner';

vi.mock('server-only', () => ({}));
const compositionMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: () => compositionMocks.execute,
}));
vi.mock('./prefunded-card-checkout-provider', () => ({
  createPrefundedCardCheckoutProvider: () => ({
    verify: compositionMocks.verify,
  }),
}));

const scope = {
  deployment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business_staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  databaseName: 'baci_staging',
};
const token = '20000000-0000-4000-8000-000000000001';
const cursor = {
  createdAt: '2026-09-27T12:00:00.000Z',
  intentId: '30000000-0000-4000-8000-000000000001',
};
const next = {
  createdAt: '2026-09-27T12:00:01.000Z',
  intentId: '30000000-0000-4000-8000-000000000002',
};
const result = (
  nextCursor: typeof cursor | null,
  candidates = 1,
  wrapped = false
) => ({
  candidates,
  failed: 0,
  nextCursor,
  wrapped,
  pending: 0,
  reconciliations: 0,
  promoted: candidates,
});

function setup(
  options: { acquired?: unknown; pages?: unknown[]; now?: () => number } = {}
) {
  const stateStore = {
    acquire: vi
      .fn()
      .mockResolvedValue(
        options.acquired ?? { outcome: 'acquired', scope, token, cursor: null }
      ),
    commit: vi.fn().mockResolvedValue(true),
  };
  const recovery = {
    run: vi
      .fn()
      .mockImplementation(async () => options.pages?.shift() ?? result(next)),
  };
  const runner = createPrefundedCardCheckoutRecoveryRunner({
    scope,
    recovery,
    stateStore,
    createToken: () => token,
    now: options.now ?? (() => Date.parse('2026-09-27T12:00:00Z')),
  });
  return { recovery, runner, stateStore };
}

describe('prefunded first-card durable recovery runner', () => {
  it('uses the validated October lease for runtime expiry', async () => {
    const renewedScope = { ...scope, expiresAt: '2026-10-06T15:59:10Z' };
    const stateStore = {
      acquire: vi.fn().mockResolvedValue({
        outcome: 'acquired',
        scope: renewedScope,
        token,
        cursor: null,
      }),
      commit: vi.fn().mockResolvedValue(true),
    };
    const runner = createPrefundedCardCheckoutRecoveryRunner({
      scope: renewedScope,
      recovery: { run: vi.fn().mockResolvedValue(result(null, 0)) },
      stateStore,
      now: () => Date.parse('2026-10-06T15:59:09Z'),
      createToken: () => token,
    });
    await expect(runner.run()).resolves.toMatchObject({ status: 'completed' });
    expect(stateStore.acquire).toHaveBeenCalledOnce();
  });

  it('passes the actual recovery composition result through the runner contract', async () => {
    const fixture = prefundedCardCheckoutFixture();
    compositionMocks.execute.mockResolvedValueOnce({
      rows: [{ result: { candidates: [], nextCursor: null } }],
    });
    const recovery = createPrefundedCardCheckoutRecoveryComposition({
      configuration: {
        scope: fixture.scope,
        authorizerDatabase: fixture.configuration.verifierDatabase,
        provider: fixture.configuration.provider,
      },
      fetchImplementation: vi.fn() as unknown as typeof fetch,
    });
    const stateStore = {
      acquire: vi.fn().mockResolvedValue({
        outcome: 'acquired',
        scope: {
          ...fixture.scope,
          databaseName: fixture.configuration.verifierDatabase.database,
        },
        token,
        cursor: null,
      }),
      commit: vi.fn().mockResolvedValue(true),
    };
    const runner = createPrefundedCardCheckoutRecoveryRunner({
      scope: {
        ...fixture.scope,
        databaseName: fixture.configuration.verifierDatabase.database,
      },
      recovery,
      stateStore,
      createToken: () => token,
      now: () => Date.parse('2026-09-27T12:00:00Z'),
    });

    await expect(recovery.run({ limit: 4 })).resolves.toEqual({
      candidates: 0,
      failed: 0,
      nextCursor: null,
      wrapped: false,
      pending: 0,
      reconciliations: 0,
      promoted: 0,
    });
    compositionMocks.execute.mockResolvedValueOnce({
      rows: [{ result: { candidates: [], nextCursor: null } }],
    });
    await expect(runner.run()).resolves.toMatchObject({
      status: 'completed',
      pages: 1,
    });
    expect(stateStore.commit).toHaveBeenCalledWith({
      scope: {
        ...fixture.scope,
        databaseName: fixture.configuration.verifierDatabase.database,
      },
      token,
      cursor: null,
    });
  });

  it('rejects a scope outside the fixed staging database and deadline', () => {
    expect(() =>
      createPrefundedCardCheckoutRecoveryRunner({
        scope: { ...scope, systemIdentifier: '1' },
        recovery: { run: vi.fn() },
        stateStore: { acquire: vi.fn(), commit: vi.fn() },
      })
    ).toThrow('First-card recovery runner unavailable');
  });

  it('does not enter recovery when the executable lock reports overlap', async () => {
    const { recovery, runner, stateStore } = setup({
      acquired: { outcome: 'busy' },
    });
    await expect(runner.run()).resolves.toEqual({ status: 'busy' });
    expect(recovery.run).not.toHaveBeenCalled();
    expect(stateStore.commit).not.toHaveBeenCalled();
  });

  it('fails closed on wrong scope or corrupt persisted cursor state', async () => {
    for (const acquired of [
      {
        outcome: 'acquired',
        scope: { ...scope, merchantId: '10000000-0000-4000-8000-000000000099' },
        token,
        cursor: null,
      },
      {
        outcome: 'acquired',
        scope,
        token,
        cursor: { createdAt: 'bad', intentId: 'bad' },
      },
    ]) {
      const { recovery, runner, stateStore } = setup({ acquired });
      await expect(runner.run()).resolves.toEqual({ status: 'failed' });
      expect(recovery.run).not.toHaveBeenCalled();
      expect(stateStore.commit).not.toHaveBeenCalled();
    }
  });

  it('persists only after a bounded pass and resets only on explicit wrap', async () => {
    const { runner, recovery, stateStore } = setup({
      acquired: { outcome: 'acquired', scope, token, cursor: next },
      pages: [result(cursor, 1, true)],
    });
    await expect(runner.run()).resolves.toEqual({
      status: 'completed',
      pages: 1,
      candidates: 1,
      failed: 0,
      pending: 0,
      reconciliations: 0,
      promoted: 1,
    });
    expect(recovery.run).toHaveBeenCalledWith({ after: next, limit: 4 });
    expect(stateStore.commit).toHaveBeenCalledWith({
      scope,
      token,
      cursor: null,
    });
  });

  it('rejects backward cursors unless recovery explicitly reports a sweep wrap', async () => {
    const { runner, stateStore } = setup({
      acquired: { outcome: 'acquired', scope, token, cursor: next },
      pages: [result(cursor)],
    });
    await expect(runner.run()).resolves.toEqual({ status: 'failed' });
    expect(stateStore.commit).not.toHaveBeenCalled();
  });

  it('revisits older unresolved rows after the explicit sweep reset', async () => {
    const first = setup({
      acquired: { outcome: 'acquired', scope, token, cursor: next },
      pages: [result(cursor, 1, true)],
    });
    await first.runner.run();
    const second = setup({ pages: [result(cursor)] });
    await second.runner.run();
    expect(second.recovery.run).toHaveBeenCalledWith({ after: null, limit: 4 });
  });

  it('does not commit after recovery fails and redacts the thrown error', async () => {
    const { runner, recovery, stateStore } = setup();
    recovery.run.mockRejectedValueOnce(new Error('provider secret text'));
    const response = await runner.run();
    expect(response).toEqual({ status: 'failed' });
    expect(JSON.stringify(response)).not.toContain('provider secret text');
    expect(stateStore.commit).not.toHaveBeenCalled();
  });

  it('fails closed when the injected clock becomes non-finite during the pass', async () => {
    const { runner, recovery, stateStore } = setup({
      now: vi
        .fn()
        .mockReturnValueOnce(Date.parse('2026-09-27T12:00:00Z'))
        .mockReturnValueOnce(Date.parse('2026-09-27T12:00:01Z'))
        .mockReturnValueOnce(Date.parse('2026-09-27T12:00:02Z'))
        .mockReturnValueOnce(Number.NaN),
    });
    recovery.run.mockResolvedValueOnce(result(next));
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(stateStore.commit).not.toHaveBeenCalled();
  });

  it('stops before processing when the fixed deadline has passed', async () => {
    const { runner, recovery, stateStore } = setup({
      now: () => Date.parse('2026-09-29T15:59:10Z'),
    });
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(stateStore.acquire).not.toHaveBeenCalled();
    expect(recovery.run).not.toHaveBeenCalled();
  });
});
