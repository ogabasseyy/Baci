import { describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
  executeWith,
  INTEGRATION,
  makeDeps,
  runtime,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

describe('runPiggyvestDailyReconciliation', () => {
  it('does nothing while its own switch is off, and never touches a dependency', async () => {
    const { deps } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({
      env: { ...env, PIGGYVEST_RECONCILIATION_ENABLED: undefined } as never,
      deps,
    });
    expect(result).toEqual({ status: 'disabled' });
    for (const fn of [
      deps.readRuntime,
      deps.createExecutor,
      deps.sendEmail,
      deps.emitAlert,
    ])
      expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    'true',
    '',
    'typo',
  ])('still runs the read-only report when the kill switch is %j', async (kill) => {
    const { deps } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({
      env: { ...env, PIGGYVEST_KILL_SWITCH: kill } as never,
      deps,
    });
    expect(result).not.toEqual({ status: 'disabled' });
    expect(deps.readRuntime).toHaveBeenCalled();
    expect(deps.sendEmail).toHaveBeenCalled();
  });

  it.each(['false', '1', 'TRUE', ''])('treats %j as off', async (value) => {
    const { deps } = makeDeps();
    expect(
      await runPiggyvestDailyReconciliation({
        env: { ...env, PIGGYVEST_RECONCILIATION_ENABLED: value } as never,
        deps,
      })
    ).toEqual({ status: 'disabled' });
  });

  it('reads the database with the fixed cutoff, emails a clean report, and sends no page', async () => {
    const { deps, execute } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result',
      [
        INTEGRATION,
        'staging',
        JSON.stringify({ staleAfterSeconds: 1800, rotationSlot: 0 }),
      ]
    );
    expect(deps.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.test',
        subject: 'PiggyVest daily reconciliation: all clear (2026-11-03)',
      })
    );
    expect(deps.emitAlert).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'reported',
      report: 'clean',
      emailed: true,
      paged: false,
    });
  });

  it('asks PiggyVest for the status of a stuck transfer with our binding, emails, and pages', async () => {
    const stuck = {
      operationId: '00000000-0000-4000-8000-0000000000a3',
      goalId: '00000000-0000-4000-8000-0000000000b1',
      state: 'dispatched',
      amountKobo: 70000,
      sourceWalletId: 'synthetic-main',
      destinationWalletId: 'synthetic-goal-b',
      reference: 'synthetic-reference-1',
      ageSeconds: 3600,
    };
    const { deps } = makeDeps({
      createExecutor: vi.fn(() =>
        executeWith(snapshot({ stuck: [stuck], stuckTotal: 1 }))
      ) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(deps.readProviderTransfer).toHaveBeenCalledWith({
      reference: 'synthetic-reference-1',
      expected: {
        amountKobo: 70000,
        source: { walletId: 'synthetic-main', currency: 'NGN', role: 'main' },
        destination: {
          walletId: 'synthetic-goal-b',
          currency: 'NGN',
          role: 'goal',
        },
        businessId: 'synthetic-business',
      },
      transport: {
        environment: 'staging',
        token: runtime.providerToken,
        fetchImplementation: expect.any(Function),
      },
    });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      {
        reason: 'stuck=1 below_expected=0 unreadable=0 truncated=no',
      }
    );
    expect(result).toEqual({
      status: 'reported',
      report: 'attention',
      emailed: true,
      paged: true,
    });
  });

  it('pages when a goal wallet holds less than recorded, reading the balance from the bound wallet', async () => {
    const { deps } = makeDeps({
      createExecutor: vi.fn(() =>
        executeWith(
          snapshot({
            wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
            walletsTotal: 1,
          })
        )
      ) as never,
      retrieveWallet: vi.fn(async (_c: unknown, id: string) => ({
        id,
        business_id: 'synthetic-business',
        balance: 1000,
      })) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(deps.retrieveWallet).toHaveBeenCalledWith(
      {
        baseUrl: 'https://staging.piggyvest.business',
        token: runtime.providerToken,
      },
      'goal-a'
    );
    expect(result).toMatchObject({ report: 'attention', paged: true });
  });

  it.each([
    [
      'another wallet id',
      { id: 'someone-else', business_id: 'synthetic-business', balance: 1500 },
    ],
    [
      'another business',
      { id: 'goal-a', business_id: 'other-business', balance: 1500 },
    ],
  ])('reads the balance as unreadable (and pages) for %s', async (_l, wallet) => {
    const { deps } = makeDeps({
      createExecutor: vi.fn(() =>
        executeWith(
          snapshot({
            wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
            walletsTotal: 1,
          })
        )
      ) as never,
      retrieveWallet: vi.fn(async () => wallet) as never,
    });
    expect(await runPiggyvestDailyReconciliation({ env, deps })).toMatchObject({
      report: 'attention',
      paged: true,
    });
  });
});
