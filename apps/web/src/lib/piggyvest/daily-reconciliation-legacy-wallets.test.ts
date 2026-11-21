import { describe, expect, it, vi } from 'vitest';
import { readMigratedLegacyWallets } from './daily-reconciliation-legacy-wallets';
import { LEGACY_MIGRATED_WALLET_STATEMENTS } from './legacy-migrated-wallet-statements';

vi.mock('server-only', () => ({}));

const WALLET_A = '0b3f1e0a-0000-4000-8000-0000000000a1';

function executeReturning(result: unknown) {
  return vi.fn(async () => ({ rows: [{ result }] }));
}

describe('readMigratedLegacyWallets', () => {
  it('reads with the evidence statement scoped to the integration', async () => {
    const execute = executeReturning({
      count: 1,
      totalBalance: '500.00',
      wallets: [{ walletId: WALLET_A, balance: '500.00' }],
    });
    const summary = await readMigratedLegacyWallets({
      execute,
      integrationId: 'integration-1',
      environment: 'production',
    });
    expect(execute).toHaveBeenCalledWith(
      LEGACY_MIGRATED_WALLET_STATEMENTS.readBalances,
      ['integration-1', 'production', '{}']
    );
    expect(summary.count).toBe(1);
  });

  it.each([
    ['a missing count', { totalBalance: '0.00', wallets: [] }],
    ['a numeric balance', { count: 0, totalBalance: 0, wallets: [] }],
    [
      'a count with no wallet ids',
      { count: 1, totalBalance: '1.00', wallets: [] },
    ],
    [
      'more wallet ids than the count',
      {
        count: 0,
        totalBalance: '1.00',
        wallets: [{ walletId: WALLET_A, balance: '1.00' }],
      },
    ],
    [
      'an unexpected key',
      { count: 0, totalBalance: '0.00', wallets: [], names: [] },
    ],
    [
      'a wallet id that is not a uuid',
      {
        count: 1,
        totalBalance: '1.00',
        wallets: [{ walletId: 'x', balance: '1.00' }],
      },
    ],
  ])('throws on %s, so the run is never reported clear', async (_label, result) => {
    await expect(
      readMigratedLegacyWallets({
        execute: executeReturning(result),
        integrationId: 'integration-1',
        environment: 'production',
      })
    ).rejects.toThrow();
  });
});
