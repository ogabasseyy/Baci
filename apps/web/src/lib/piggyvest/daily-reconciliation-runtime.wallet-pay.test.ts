import { describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
  executeWith,
  ledger,
  makeDeps,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

vi.mock('server-only', () => ({}));

describe('runPiggyvestDailyReconciliation: wallet pay lines', () => {
  it('pages and emails when a wallet payment is stuck, undelivered or waiting for review', async () => {
    const execute = executeWith(snapshot(), ledger(), {
      stuckPayments: [{ operationId: 'a' }],
      undelivered: [],
      unrefunded: [{ operationId: 'b' }],
      needsReview: [],
    });
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ status: 'reported', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      expect.objectContaining({
        reason: expect.stringContaining(
          'wallet_pay stuck=1 undelivered=0 unrefunded=1 review=0'
        ),
      })
    );
    expect(vi.mocked(deps.sendEmail).mock.calls[0][0].textContent).toContain(
      'Refund owed, not yet sent: 1'
    );
  });

  it('pages when the wallet pay report can not be read (never all clear)', async () => {
    const base = executeWith();
    const execute = vi.fn(async (statement?: string) =>
      statement?.includes('read_wallet_pay_reconciliation')
        ? Promise.reject(new Error('db'))
        : base(statement)
    );
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      expect.objectContaining({
        reason: expect.stringContaining('wallet_pay_unreadable'),
      })
    );
  });

  it('bugfix: a failed main report still emails and pages stuck wallet payments', async () => {
    const execute = executeWith(
      snapshot({ businessId: 'other-business' }),
      ledger(),
      {
        stuckPayments: [{ operationId: 'a' }],
        undelivered: [],
        unrefunded: [],
        needsReview: [],
      }
    );
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'failed', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      expect.objectContaining({
        reason: expect.stringContaining('wallet_pay stuck=1'),
      })
    );
  });
});

describe('runPiggyvestDailyReconciliation: moved legacy wallets', () => {
  it('regression: pages and emails when a wallet already moved to PiggyVest holds money again', async () => {
    const execute = executeWith(snapshot(), ledger(), undefined, {
      count: 1,
      totalBalance: '500.00',
      wallets: [
        { walletId: '0b3f1e0a-0000-4000-8000-0000000000a1', balance: '500.00' },
      ],
    });
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ status: 'reported', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      expect.objectContaining({
        reason: expect.stringContaining('legacy_migrated_with_balance=1'),
      })
    );
    const sent = vi.mocked(deps.sendEmail).mock.calls[0][0];
    expect(sent.textContent).toContain(
      'Moved legacy wallets holding money again: 1 (NGN 500.00 in all).'
    );
    expect(sent.subject).toMatch(/^ATTENTION, see below: /);
  });

  it('regression: puts the moved-wallet marker ahead of the main report so clipping can not drop it', async () => {
    const execute = executeWith(snapshot(), ledger(), undefined, {
      count: 2,
      totalBalance: '9.00',
      wallets: [],
    });
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
      readProviderTransfer: vi.fn(async () => {
        throw new Error('provider down');
      }) as never,
      sendEmail: vi.fn(async () => ({ success: false })),
    });
    await runPiggyvestDailyReconciliation({ env, deps });
    const reason = String(
      (vi.mocked(deps.emitAlert).mock.calls[0][1] as { reason: string }).reason
    );
    expect(
      reason.startsWith('report_email_failed legacy_migrated_with_balance=2')
    ).toBe(true);
  });

  it('pages when the moved-wallet read fails (never all clear)', async () => {
    const base = executeWith();
    const execute = vi.fn(async (statement?: string) =>
      statement?.includes('read_migrated_legacy_wallet_balances')
        ? Promise.reject(new Error('db'))
        : base(statement)
    );
    const { deps } = makeDeps({
      createExecutor: vi.fn(() => execute) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      expect.objectContaining({
        reason: expect.stringContaining('legacy_migrated_unreadable'),
      })
    );
  });

  it('stays clear and says so when no moved wallet holds money', async () => {
    const { deps } = makeDeps();
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ paged: false });
    const sent = vi.mocked(deps.sendEmail).mock.calls[0][0];
    expect(sent.textContent).toContain(
      'Moved legacy wallets: none hold money again.'
    );
    expect(sent.subject).not.toMatch(/ATTENTION/);
  });
});
