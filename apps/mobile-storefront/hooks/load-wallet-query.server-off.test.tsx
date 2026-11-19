import { describe, expect, it, jest } from '@jest/globals';
import { loadWalletQuery } from './load-wallet-query';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./wallet-data', () => ({
  fetchWalletDataUnbounded: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('./wallet-load-deadline', () => ({
  runWithWalletLoadDeadline: (load: () => Promise<unknown>) => load(),
}));

describe('loadWalletQuery with the server keeping PiggyVest off', () => {
  it('returns the loaded legacy wallet unchanged', async () => {
    const loaded = {
      transactions: [],
      wallet: { balance: 500, funding_account: null, loyalty_points: 0 },
    };
    mockFetch.mockResolvedValue(loaded);

    await expect(
      loadWalletQuery({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        previous: () => undefined,
        userId: 'user-1',
      })
    ).resolves.toEqual(loaded);
    expect(mockFetch).toHaveBeenCalledWith(
      'customer-1',
      'merchant-1',
      'user-1'
    );
  });
});

describe('bugfix: cold launch with the server unreachable (walk 11)', () => {
  it('keeps the cached PiggyVest account when the fresh read failed', async () => {
    const account = {
      account_name: 'OGB / ADA',
      account_number: '9814644749',
      bank_name: 'Provider Bank',
      provider: 'piggyvest',
    };
    mockFetch.mockResolvedValue({
      transactions: [],
      wallet: {
        balance: 0,
        funding_account: null,
        loyalty_points: 0,
        primary_unavailable: true,
      },
    });

    const loaded = await loadWalletQuery({
      customerId: 'customer-1',
      merchantId: 'merchant-1',
      previous: () =>
        ({
          transactions: [],
          wallet: { balance: 0, funding_account: account, loyalty_points: 0 },
        }) as never,
      userId: 'user-1',
    });

    expect(loaded.wallet.funding_account).toEqual(account);
  });
});

describe('bugfix: cold launch with no cached wallet lost the account (walk 14)', () => {
  it('shows the account saved on the device when the fresh read failed', async () => {
    const account = {
      account_name: 'OGB / ADA',
      account_number: '9814644749',
      bank_name: 'Provider Bank',
      provider: 'piggyvest',
    };
    mockFetch.mockResolvedValueOnce({
      transactions: [],
      wallet: { balance: 0, funding_account: account, loyalty_points: 0 },
    });
    await loadWalletQuery({
      customerId: 'customer-1',
      merchantId: 'merchant-9',
      previous: () => undefined,
      userId: 'user-9',
    });
    mockFetch.mockResolvedValueOnce({
      transactions: [],
      wallet: {
        balance: 0,
        funding_account: null,
        loyalty_points: 0,
        primary_unavailable: true,
      },
    });

    // Cold launch: the query cache is empty.
    const loaded = await loadWalletQuery({
      customerId: 'customer-1',
      merchantId: 'merchant-9',
      previous: () => undefined,
      userId: 'user-9',
    });

    expect(loaded.wallet.funding_account).toEqual(account);
    expect(loaded.wallet.requires_funding_account_consent).toBe(false);
    expect(loaded.wallet.primary_unavailable).toBe(true);
  });
});
