import { describe, expect, it, vi } from 'vitest';
import { readSideChecks } from './daily-reconciliation-side-checks';

vi.mock('server-only', () => ({}));

const input = { integrationId: 'integration-1', environment: 'production' };

describe('readSideChecks', () => {
  it('runs both reads and orders the moved-wallet reason first', async () => {
    const execute = vi.fn(async (statement: string) => ({
      rows: [
        {
          result: statement.includes('read_migrated_legacy_wallet_balances')
            ? { count: 1, totalBalance: '5.00', wallets: [] }
            : {
                stuckPayments: [{ operationId: 'a' }],
                undelivered: [],
                unrefunded: [],
                needsReview: [],
              },
        },
      ],
    }));
    const checks = await readSideChecks({ execute, ...input });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(checks.reasons[0]).toBe('legacy_migrated_with_balance=1');
    expect(checks.reasons[1]).toContain('wallet_pay stuck=1');
    expect(checks.attention).toBe(true);
  });

  it('regression: never throws, so the email and page still go out when every read fails', async () => {
    const execute = vi.fn(() => {
      throw new Error('executor exploded');
    });
    const checks = await readSideChecks({ execute, ...input });
    expect(checks.reasons).toEqual([
      'legacy_migrated_unreadable',
      'wallet_pay_unreadable',
    ]);
    expect(checks.attention).toBe(true);
    expect(checks.lines.join('\n')).toContain('could not be read');
  });
});
