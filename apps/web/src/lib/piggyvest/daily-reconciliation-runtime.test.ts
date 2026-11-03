import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type DailyReconciliationDeps,
  runPiggyvestDailyReconciliation,
} from './daily-reconciliation-runtime';

const digest = (label: string) =>
  createHash('sha256').update(label).digest('hex');
const INTEGRATION = '00000000-0000-4000-8000-000000000001';
const GENERATED_AT = '2026-11-03T01:29:30.079678+01:00';

const env = {
  PIGGYVEST_RECONCILIATION_ENABLED: 'true',
  PIGGYVEST_RECONCILIATION_REPORT_EMAIL: 'owner@example.test',
} as unknown as NodeJS.ProcessEnv;

const runtime = {
  configuration: { integrationId: INTEGRATION, environment: 'staging' },
  reconciliationConfiguration: {
    integrationId: INTEGRATION,
    environment: 'staging',
  },
  businessId: 'synthetic-business',
  providerToken: digest('provider-token'),
  merchantId: '00000000-0000-4000-8000-000000000002',
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: GENERATED_AT,
    staleAfterSeconds: 1800,
    businessId: 'synthetic-business',
    stuck: [],
    stuckTotal: 0,
    wallets: [],
    walletsTotal: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DailyReconciliationDeps> = {}) {
  const execute = vi.fn(async () => ({ rows: [{ result: snapshot() }] }));
  const deps: DailyReconciliationDeps = {
    readRuntime: vi.fn(() => runtime) as never,
    createExecutor: vi.fn(() => execute) as never,
    readProviderTransfer: vi.fn(async () => ({
      outcome: 'pending' as const,
    })) as never,
    retrieveWallet: vi.fn(async (_c: unknown, id: string) => ({
      id,
      business_id: 'synthetic-business',
      balance: 0,
    })) as never,
    sendEmail: vi.fn(async () => ({ success: true })),
    emitAlert: vi.fn(),
    now: () => '2026-11-03T00:30:00.000Z',
    nowMs: () => 0,
    ...overrides,
  };
  return { deps, execute };
}

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

  it('fails and pages, never reads clean, when the snapshot is for another business or cutoff', async () => {
    for (const bad of [
      snapshot({ businessId: 'other-business' }),
      snapshot({ staleAfterSeconds: 3600 }),
    ]) {
      const { deps } = makeDeps({
        createExecutor: vi.fn(() =>
          vi.fn(async () => ({ rows: [{ result: bad }] }))
        ) as never,
      });
      const result = await runPiggyvestDailyReconciliation({ env, deps });
      expect(result).toEqual({
        status: 'reported',
        report: 'failed',
        emailed: true,
        paged: true,
      });
      expect(deps.emitAlert).toHaveBeenCalledWith(
        'PIGGYVEST_RECONCILIATION_MISMATCH',
        {
          reason: 'reconciliation_failed:snapshot_invalid',
        }
      );
    }
  });

  it('fails and pages when the runtime is not configured', async () => {
    const { deps } = makeDeps({
      readRuntime: vi.fn(() => {
        throw new Error('Primary savings configuration unavailable');
      }),
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toEqual({
      status: 'reported',
      report: 'failed',
      emailed: true,
      paged: true,
    });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      {
        reason: 'reconciliation_failed:not_configured',
      }
    );
    expect(deps.createExecutor).not.toHaveBeenCalled();
  });

  it('fails and pages when the database handle cannot be built', async () => {
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => {
        throw new Error('bad configuration');
      }) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'failed', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      {
        reason: 'reconciliation_failed:not_configured',
      }
    );
  });

  it('fails and pages when the database read throws', async () => {
    const { deps } = makeDeps({
      createExecutor: vi.fn(() =>
        vi.fn(async () => {
          throw new Error('down');
        })
      ) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'failed', paged: true });
  });

  it('pages when a clean report could not be emailed', async () => {
    const { deps } = makeDeps({
      sendEmail: vi.fn(async () => ({ success: false })),
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toEqual({
      status: 'reported',
      report: 'clean',
      emailed: false,
      paged: true,
    });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      {
        reason: 'report_email_failed',
      }
    );
  });

  it.each([
    [
      'throws',
      vi.fn(async () => {
        throw new Error('smtp');
      }),
    ],
  ])('pages when the email sender %s', async (_l, sendEmail) => {
    const { deps } = makeDeps({ sendEmail });
    expect(await runPiggyvestDailyReconciliation({ env, deps })).toMatchObject({
      emailed: false,
      paged: true,
    });
  });

  it.each([
    undefined,
    '',
    'not-an-email',
  ])('pages without sending when the owner address is %j', async (address) => {
    const { deps } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({
      env: { ...env, PIGGYVEST_RECONCILIATION_REPORT_EMAIL: address } as never,
      deps,
    });
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ emailed: false, paged: true });
  });

  it('joins the attention counts and the email failure into one page reason', async () => {
    const { deps } = makeDeps({
      sendEmail: vi.fn(async () => ({ success: false })),
      createExecutor: vi.fn(() =>
        vi.fn(async () => ({
          rows: [{ result: snapshot({ stuckTotal: 1, stuck: [] }) }],
        }))
      ) as never,
    });
    await runPiggyvestDailyReconciliation({ env, deps });
    const [, detail] = vi.mocked(deps.emitAlert).mock.calls[0];
    expect(detail.reason).toBe(
      'stuck=1 below_expected=0 unreadable=0 truncated=yes report_email_failed'
    );
  });

  it('never puts credentials in the email or the page', async () => {
    const { deps } = makeDeps();
    await runPiggyvestDailyReconciliation({ env, deps });
    const sent = JSON.stringify(vi.mocked(deps.sendEmail).mock.calls);
    expect(sent).not.toContain(runtime.providerToken);
  });
  it('still emails and pages when a slow PiggyVest uses up the read budget', async () => {
    let ms = 0;
    const wallets = Array.from({ length: 50 }, (_, i) => ({
      walletId: `goal-${i}`,
      expectedKobo: 100,
    }));
    const { deps, execute } = makeDeps({
      nowMs: () => ms,
      retrieveWallet: vi.fn(async (_c: unknown, id: string) => {
        ms += 30_000;
        return { id, business_id: 'synthetic-business', balance: 100 };
      }) as never,
    });
    execute.mockResolvedValue({
      rows: [{ result: snapshot({ wallets, walletsTotal: 50 }) }],
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    // Each batch of five costs 150s of the 200s budget: two batches start.
    expect(deps.retrieveWallet).toHaveBeenCalledTimes(10);
    expect(result).toEqual({
      status: 'reported',
      report: 'attention',
      emailed: true,
      paged: true,
    });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      { reason: expect.stringContaining('deadline=reached') }
    );
  });
});
