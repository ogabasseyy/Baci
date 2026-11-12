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
});
