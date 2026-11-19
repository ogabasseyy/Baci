import { describe, expect, it, vi } from 'vitest';
import {
  readWalletPaySummary,
  walletPayEmailLines,
  walletPayPageReason,
} from './daily-reconciliation-wallet-pay';
import { WALLET_PAY_EVIDENCE_STATEMENTS } from './wallet-pay-statements';

vi.mock('server-only', () => ({}));

const INTEGRATION = '8e3a5c62-4f4f-4a8e-9d73-5b6c7d8e9fa1';
const rows = (result: unknown) => ({ rows: [{ result }] });
const empty = {
  stuckPayments: [],
  undelivered: [],
  unrefunded: [],
  needsReview: [],
};

describe('readWalletPaySummary', () => {
  it('counts each wallet pay line from the read-only database report', async () => {
    const execute = vi.fn(async () =>
      rows({
        ...empty,
        stuckPayments: [{ operationId: 'a' }, { operationId: 'b' }],
        needsReview: [{ operationId: 'c', reviewReason: 'fee_charged' }],
      })
    );
    await expect(
      readWalletPaySummary({
        execute,
        integrationId: INTEGRATION,
        environment: 'staging',
      })
    ).resolves.toEqual({ stuck: 2, undelivered: 0, unrefunded: 0, review: 1 });
    expect(execute).toHaveBeenCalledWith(
      WALLET_PAY_EVIDENCE_STATEMENTS.reconciliation,
      [INTEGRATION, 'staging', '{}']
    );
  });

  it('treats an unreadable answer as a failure (never as all clear)', async () => {
    const execute = vi.fn(async () => rows({ stuckPayments: 'x' }));
    await expect(
      readWalletPaySummary({
        execute,
        integrationId: INTEGRATION,
        environment: 'staging',
      })
    ).rejects.toThrow();
  });
});

describe('wallet pay report lines and page', () => {
  it('pages and lists every non-empty line', () => {
    const summary = { stuck: 1, undelivered: 2, unrefunded: 0, review: 3 };
    expect(walletPayPageReason(summary)).toBe(
      'wallet_pay stuck=1 undelivered=2 unrefunded=0 review=3'
    );
    expect(walletPayEmailLines(summary).join('\n')).toContain(
      'Paid but not delivered: 2'
    );
  });

  it('is silent when nothing is outstanding', () => {
    const summary = { stuck: 0, undelivered: 0, unrefunded: 0, review: 0 };
    expect(walletPayPageReason(summary)).toBeNull();
    expect(walletPayEmailLines(summary)).toEqual([
      'PiggyVest wallet payments: nothing outstanding.',
    ]);
  });

  it('pages when the wallet pay read failed', () => {
    expect(walletPayPageReason(null)).toBe('wallet_pay_unreadable');
    expect(walletPayEmailLines(null)[0]).toContain('could not be read');
  });
});
