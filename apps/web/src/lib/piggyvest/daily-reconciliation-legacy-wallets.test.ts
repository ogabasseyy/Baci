import { describe, expect, it, vi } from 'vitest';
import {
  MIGRATED_LEGACY_WALLETS_STATEMENT,
  migratedLegacyWalletEmailLines,
  migratedLegacyWalletPageReason,
  readMigratedLegacyWallets,
} from './daily-reconciliation-legacy-wallets';

vi.mock('server-only', () => ({}));

const WALLET_A = '0b3f1e0a-0000-4000-8000-0000000000a1';
const WALLET_B = '0b3f1e0a-0000-4000-8000-0000000000b2';

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
    expect(execute).toHaveBeenCalledWith(MIGRATED_LEGACY_WALLETS_STATEMENT, [
      'integration-1',
      'production',
      '{}',
    ]);
    expect(summary.count).toBe(1);
  });

  it.each([
    ['a missing count', { totalBalance: '0.00', wallets: [] }],
    ['a numeric balance', { count: 0, totalBalance: 0, wallets: [] }],
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

describe('migrated legacy wallet email and page', () => {
  it('is clear when no moved wallet holds money', () => {
    const clear = { count: 0, totalBalance: '0.00', wallets: [] };
    expect(migratedLegacyWalletPageReason(clear)).toBeNull();
    expect(migratedLegacyWalletEmailLines(clear)).toEqual([
      'Moved legacy wallets: none hold money again.',
    ]);
  });

  it('pages with the count and lists each wallet with the never-credit-twice warning', () => {
    const summary = {
      count: 2,
      totalBalance: '1750.50',
      wallets: [
        { walletId: WALLET_B, balance: '1250.50' },
        { walletId: WALLET_A, balance: '500.00' },
      ],
    };
    expect(migratedLegacyWalletPageReason(summary)).toBe(
      'legacy_migrated_with_balance=2'
    );
    const lines = migratedLegacyWalletEmailLines(summary);
    expect(lines[0]).toBe(
      'Moved legacy wallets holding money again: 2 (NGN 1750.50 in all).'
    );
    expect(lines[1]).toContain('never credit PiggyVest a second time');
    expect(lines).toContain(`Wallet ${WALLET_B}: NGN 1250.50`);
    expect(lines).toContain(`Wallet ${WALLET_A}: NGN 500.00`);
  });

  it('shows at most ten wallets and counts the rest', () => {
    const wallets = Array.from({ length: 12 }, (_, index) => ({
      walletId: `0b3f1e0a-0000-4000-8000-${String(index).padStart(12, '0')}`,
      balance: '1.00',
    }));
    const lines = migratedLegacyWalletEmailLines({
      count: 30,
      totalBalance: '30.00',
      wallets,
    });
    expect(lines.filter((line) => line.startsWith('Wallet '))).toHaveLength(10);
    expect(lines.at(-1)).toBe('And 20 more (see the runbook balance list).');
  });

  it('pages as unreadable, never clear, when the read failed', () => {
    expect(migratedLegacyWalletPageReason(null)).toBe(
      'legacy_migrated_unreadable'
    );
    expect(migratedLegacyWalletEmailLines(null)[0]).toContain(
      'could not be read'
    );
  });
});
