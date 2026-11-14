import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchWalletDataUnbounded } from './wallet-data';

const mockFrom = jest.fn<(table: string) => unknown>();
const mockRpc = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockReadPrimarySoon = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('./wallet-primary-balance', () => {
  const actual = jest.requireActual(
    './wallet-primary-balance'
  ) as typeof import('./wallet-primary-balance');
  return {
    ...actual,
    readPrimaryFundingAccountSoon: () => mockReadPrimarySoon(),
  };
});

const legacyAccount = {
  account_name: 'Legacy',
  account_number: '0123456789',
  bank_name: 'Paystack Bank',
  provider: 'paystack',
};

function setupTables(customers: unknown = [{ id: 'c1', loyalty_points: 10 }]) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    customers: { data: customers, error: null },
    customer_wallets: {
      data: { id: 'w1', available_balance: '5000' },
      error: null,
    },
    customer_wallet_payment_accounts: { data: legacyAccount, error: null },
    customer_savings_goals: { data: [], error: null },
    customer_wallet_transactions: { data: [], error: null },
  };
  mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
  mockFrom.mockImplementation((table: string) => {
    const query = {
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      limit: jest.fn(async () => results[table]),
      maybeSingle: jest.fn(async () => results[table]),
      order: jest.fn(() =>
        table === 'customer_savings_goals'
          ? Promise.resolve(results[table])
          : query
      ),
      select: jest.fn(() => query),
    };
    return query;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupTables();
});

describe('wallet data with the server off', () => {
  it('loads the legacy wallet with no primary balance when not ready', async () => {
    mockReadPrimarySoon.mockResolvedValue({ status: 'not_ready' });
    const { wallet } = await fetchWalletDataUnbounded('c1', 'm1', 'u1');
    expect(wallet.balance).toBe(5000);
    expect(wallet.total_balance).toBe(5000);
    expect('primary_balance_kobo' in wallet).toBe(false);
    expect(wallet.funding_account).toEqual(legacyAccount);
  });

  it('still loads, with no account and no primary balance, when the probe fails', async () => {
    mockReadPrimarySoon.mockResolvedValue({ status: 'unavailable' });
    const { wallet } = await fetchWalletDataUnbounded('c1', 'm1', 'u1');
    expect(wallet.balance).toBe(5000);
    expect('primary_balance_kobo' in wallet).toBe(false);
    expect(wallet.funding_account).toBeNull();
    expect(wallet.primary_unavailable).toBe(true);
    expect(wallet.requires_funding_account_consent).toBe(true);
  });

  it('returns an empty wallet without any lookup when nobody is signed in', async () => {
    const { wallet } = await fetchWalletDataUnbounded(null, 'm1', null);
    expect(wallet.balance).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockReadPrimarySoon).not.toHaveBeenCalled();
  });
});

describe('bugfix: wallet owner without a customer row read as a settled legacy wallet', () => {
  it('marks the empty wallet owner-unresolved when the user has no customer row', async () => {
    // Arrange: signed in, but no customer row for this merchant yet.
    setupTables([]);

    // Act
    const { wallet } = await fetchWalletDataUnbounded(null, 'm1', 'u1');

    // Assert: purchase screens can hold bank transfers until it resolves.
    expect(wallet.balance).toBe(0);
    expect(wallet.owner_unresolved).toBe(true);
  });

  it('marks it owner-unresolved when the user matches more than one row', async () => {
    setupTables([{ id: 'c1' }, { id: 'c2' }]);
    const { wallet } = await fetchWalletDataUnbounded(null, 'm1', 'u1');
    expect(wallet.owner_unresolved).toBe(true);
  });

  it('leaves a resolved customer wallet without the flag', async () => {
    mockReadPrimarySoon.mockResolvedValue({ status: 'not_ready' });
    const { wallet } = await fetchWalletDataUnbounded('c1', 'm1', 'u1');
    expect('owner_unresolved' in wallet).toBe(false);
  });
});
