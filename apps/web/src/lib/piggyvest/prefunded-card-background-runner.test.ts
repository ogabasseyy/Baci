import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardBackgroundRunner } from './prefunded-card-background-runner';

vi.mock('server-only', () => ({}));

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

function setup(
  options: {
    recoveryStatus?: unknown;
    recoveryError?: Error;
    dispatchResult?: unknown;
    dispatchError?: Error;
    now?: () => number;
  } = {}
) {
  const recovery = {
    run: vi.fn().mockImplementation(async () => {
      if (options.recoveryError) throw options.recoveryError;
      return options.recoveryStatus ?? { status: 'completed' };
    }),
  };
  const composition = {
    tick: vi.fn().mockImplementation(async () => {
      if (options.dispatchError) throw options.dispatchError;
      return (
        options.dispatchResult ?? {
          claimed: 1,
          processed: 1,
          failed: 0,
          unacknowledged: 0,
        }
      );
    }),
  };
  const runner = createPrefundedCardBackgroundRunner({
    scope,
    expectedDatabaseName: 'baci_staging',
    recovery,
    composition,
    now: options.now ?? (() => Date.parse('2026-09-27T12:00:00Z')),
  });
  return { composition, recovery, runner };
}

describe('prefunded first-card background runner', () => {
  it('runs one bounded recovery pass before dispatching one tick', async () => {
    const { composition, recovery, runner } = setup();
    await expect(runner.run()).resolves.toEqual({ status: 'completed' });
    expect(recovery.run).toHaveBeenCalledOnce();
    expect(composition.tick).toHaveBeenCalledOnce();
    await expect(runner.run()).resolves.toEqual({ status: 'busy' });
    expect(recovery.run).toHaveBeenCalledOnce();
    expect(composition.tick).toHaveBeenCalledOnce();
  });

  it('refuses a different staging scope or physical database', () => {
    expect(() =>
      createPrefundedCardBackgroundRunner({
        scope: { ...scope, systemIdentifier: '1' },
        expectedDatabaseName: 'baci_staging',
        recovery: { run: vi.fn() },
        composition: { tick: vi.fn() },
      })
    ).toThrow('Prefunded background runner unavailable');
    expect(() =>
      createPrefundedCardBackgroundRunner({
        scope,
        expectedDatabaseName: 'other_database',
        recovery: { run: vi.fn() },
        composition: { tick: vi.fn() },
      })
    ).toThrow('Prefunded background runner unavailable');
  });

  it('stops before recovery when the fixed deadline has passed', async () => {
    const { composition, recovery, runner } = setup({
      now: () => Date.parse('2026-09-29T15:59:10Z'),
    });
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(recovery.run).not.toHaveBeenCalled();
    expect(composition.tick).not.toHaveBeenCalled();
  });

  it('runs under the exact October lease and refuses arbitrary deadline values', async () => {
    const renewedScope = { ...scope, expiresAt: '2026-10-06T15:59:10Z' };
    const recovery = {
      run: vi.fn().mockResolvedValue({ status: 'completed' }),
    };
    const composition = {
      tick: vi.fn().mockResolvedValue({
        claimed: 0,
        processed: 0,
        failed: 0,
        unacknowledged: 0,
      }),
    };
    const runner = createPrefundedCardBackgroundRunner({
      scope: renewedScope,
      expectedDatabaseName: 'baci_staging',
      recovery,
      composition,
      now: () => Date.parse('2026-10-06T15:59:09Z'),
    });
    await expect(runner.run()).resolves.toEqual({ status: 'completed' });
    expect(() =>
      createPrefundedCardBackgroundRunner({
        scope: { ...renewedScope, expiresAt: '2026-10-07T00:00:00Z' },
        expectedDatabaseName: 'baci_staging',
        recovery,
        composition,
      })
    ).toThrow('Prefunded background runner unavailable');
  });

  it.each([
    { recoveryStatus: { status: 'busy' } },
    { recoveryStatus: { status: 'failed', error: 'sensitive' } },
    { recoveryStatus: { status: 'expired' } },
  ])('skips dispatch for recovery result $recoveryStatus', async ({
    recoveryStatus,
  }) => {
    const { composition, runner } = setup({ recoveryStatus });
    await runner.run();
    expect(composition.tick).not.toHaveBeenCalled();
  });

  it('redacts recovery and dispatcher exceptions', async () => {
    const recoveryFailure = setup({
      recoveryError: new Error('provider secret and database password'),
    });
    const recoveryResult = await recoveryFailure.runner.run();
    expect(recoveryResult).toEqual({ status: 'failed' });
    expect(JSON.stringify(recoveryResult)).not.toContain('provider secret');
    expect(recoveryFailure.composition.tick).not.toHaveBeenCalled();

    const dispatchFailure = setup({
      dispatchError: new Error('provider token and response body'),
    });
    const dispatchResult = await dispatchFailure.runner.run();
    expect(dispatchResult).toEqual({ status: 'failed' });
    expect(JSON.stringify(dispatchResult)).not.toContain('provider token');
  });

  it('reports bounded dispatcher counters with failures as a redacted failure', async () => {
    const { runner } = setup({
      dispatchResult: {
        claimed: 1,
        processed: 0,
        failed: 1,
        unacknowledged: 1,
        providerBody: 'sensitive response',
      },
    });
    const result = await runner.run();
    expect(result).toEqual({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain('sensitive response');
  });

  it('does not dispatch if the deadline expires during recovery', async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(Date.parse('2026-09-29T15:59:09Z'))
      .mockReturnValueOnce(Date.parse('2026-09-29T15:59:10Z'));
    const { composition, runner } = setup({ now });
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(composition.tick).not.toHaveBeenCalled();
  });

  it('does not dispatch when recovery consumes the reserved dispatch budget', async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(Date.parse('2026-09-27T12:00:00Z'))
      .mockReturnValueOnce(Date.parse('2026-09-27T12:04:00.001Z'));
    const { composition, runner } = setup({ now });
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(composition.tick).not.toHaveBeenCalled();
  });

  it.each([
    Date.parse('2026-09-29T15:59:10Z'),
    Date.parse('2026-09-27T11:59:59Z'),
  ])('does not report completion when the clock after dispatch is %s', async (finishedAt) => {
    const now = vi
      .fn()
      .mockReturnValueOnce(Date.parse('2026-09-27T12:00:00Z'))
      .mockReturnValueOnce(Date.parse('2026-09-27T12:00:01Z'))
      .mockReturnValueOnce(finishedAt);
    const { composition, runner } = setup({ now });
    await expect(runner.run()).resolves.toEqual({ status: 'expired' });
    expect(composition.tick).toHaveBeenCalledOnce();
  });
});
