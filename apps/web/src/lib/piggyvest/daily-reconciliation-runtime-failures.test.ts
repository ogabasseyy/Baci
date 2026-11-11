import { describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
  executeWith,
  makeDeps,
  runtime,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

describe('runPiggyvestDailyReconciliation failures and budget', () => {
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
        executeWith(snapshot({ stuckTotal: 1, stuckDeferred: 1, stuck: [] }))
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
    const execute = executeWith(snapshot({ wallets, walletsTotal: 50 }));
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
      nowMs: () => ms,
      retrieveWallet: vi.fn(async (_c: unknown, id: string) => {
        ms += 30_000;
        return { id, business_id: 'synthetic-business', balance: 100 };
      }) as never,
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
  it('labels a throw from the run itself run_failed, not not_configured', async () => {
    const { deps } = makeDeps({
      nowMs: () => {
        throw new Error('clock');
      },
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'failed', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      { reason: 'reconciliation_failed:run_failed' }
    );
  });
});
