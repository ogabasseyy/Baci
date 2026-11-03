import { describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
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

  it('does nothing while the PiggyVest master kill switch is on', async () => {
    const { deps } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({
      env: { ...env, PIGGYVEST_KILL_SWITCH: 'true' } as never,
      deps,
    });
    expect(result).toEqual({ status: 'disabled' });
    expect(deps.readRuntime).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
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
      [INTEGRATION, 'staging', JSON.stringify({ staleAfterSeconds: 1800 })]
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
        vi.fn(async () => ({
          rows: [{ result: snapshot({ stuck: [stuck], stuckTotal: 1 }) }],
        }))
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
        vi.fn(async () => ({
          rows: [
            {
              result: snapshot({
                wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
                walletsTotal: 1,
              }),
            },
          ],
        }))
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
        vi.fn(async () => ({
          rows: [
            {
              result: snapshot({
                wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
                walletsTotal: 1,
              }),
            },
          ],
        }))
      ) as never,
      retrieveWallet: vi.fn(async () => wallet) as never,
    });
    expect(await runPiggyvestDailyReconciliation({ env, deps })).toMatchObject({
      report: 'attention',
      paged: true,
    });
  });

  describe('surplus threshold setting', () => {
    const run = (value: string | undefined, balance: number) => {
      const { deps } = makeDeps({
        createExecutor: vi.fn(() =>
          vi.fn(async () => ({
            rows: [
              {
                result: snapshot({
                  wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
                  walletsTotal: 1,
                }),
              },
            ],
          }))
        ) as never,
        retrieveWallet: vi.fn(async (_c: unknown, id: string) => ({
          id,
          business_id: 'synthetic-business',
          balance,
        })) as never,
      });
      return runPiggyvestDailyReconciliation({
        env: {
          ...env,
          PIGGYVEST_RECONCILIATION_SURPLUS_PAGE_KOBO: value,
        } as never,
        deps,
      }).then((result) => ({ result, deps }));
    };

    it('pages a surplus at the configured threshold', async () => {
      const { result, deps } = await run('2000', 3500);
      expect(result).toMatchObject({ report: 'attention', paged: true });
      expect(deps.emitAlert).toHaveBeenCalledWith(
        'PIGGYVEST_RECONCILIATION_MISMATCH',
        {
          reason:
            'stuck=0 below_expected=0 unreadable=0 truncated=no surplus_large=1',
        }
      );
    });

    it('only reviews a surplus below the configured threshold', async () => {
      const { result } = await run('2000', 3499);
      expect(result).toMatchObject({ report: 'clean', paged: false });
    });

    it.each([
      undefined,
      '',
      'abc',
      '0',
      '-5',
      '1.5',
      '10 ',
    ])('uses the N1,000 default for %j', async (value) => {
      expect((await run(value, 1500 + 99_999)).result).toMatchObject({
        report: 'clean',
      });
      expect((await run(value, 1500 + 100_000)).result).toMatchObject({
        report: 'attention',
      });
    });
  });
});
