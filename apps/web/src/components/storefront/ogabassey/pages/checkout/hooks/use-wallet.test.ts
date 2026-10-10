import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallet } from './use-wallet';

describe('useWallet', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() =>
      useWallet({ userId: undefined, merchantSlug: undefined }),
    );

    expect(result.current.walletBalance).toBe(0);
    expect(result.current.walletLoading).toBe(false);
    expect(result.current.payWithWallet).toBe(false);
    expect(typeof result.current.setPayWithWallet).toBe('function');
    expect(typeof result.current.setWalletBalance).toBe('function');
  });

  it('should not fetch when userId is undefined', () => {
    renderHook(() => useWallet({ userId: undefined, merchantSlug: 'test-merchant' }));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when merchantSlug is undefined', () => {
    renderHook(() => useWallet({ userId: 'user-123', merchantSlug: undefined }));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch wallet balance with correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 1000 }),
    });

    renderHook(() => useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/customer/wallet?merchant=test-merchant',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  it('should set balance and enable payWithWallet when balance > 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 1500 }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletBalance).toBe(1500);
      expect(result.current.payWithWallet).toBe(true);
      expect(result.current.walletLoading).toBe(false);
    });
  });

  it('surfaces the wallet transactions (with source_type) for the funding check loop', async () => {
    const transactions = [
      {
        amount: 5000,
        balance_after: 5000,
        created_at: '2026-07-13T10:00:00.000Z',
        description: 'Wallet top-up via paystack',
        id: 'txn-1',
        source_type: 'wallet_topup',
        type: 'credit',
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 5000, transactions }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletTransactions).toEqual(transactions);
    });
  });

  it('falls back to an empty transaction list when the API omits it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 100 }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletBalance).toBe(100);
    });
    expect(result.current.walletTransactions).toEqual([]);
  });

  it('should set balance to 0 and not enable payWithWallet when balance is 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 0 }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletBalance).toBe(0);
      expect(result.current.payWithWallet).toBe(false);
      expect(result.current.walletLoading).toBe(false);
    });
  });

  it('should handle non-numeric balance values', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 'invalid' }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletBalance).toBe(0);
      expect(result.current.payWithWallet).toBe(false);
    });
  });

  it('should log error on failed fetch', async () => {
    const error = new Error('Network error');
    mockFetch.mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith('Failed to fetch wallet balance:', error);
      expect(result.current.walletLoading).toBe(false);
    });
  });

  it('should not log error on AbortError', async () => {
    const abortError = new Error('AbortError');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    renderHook(() => useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }));

    await waitFor(() => {
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  it('flags a failed fetch as an error instead of a zero balance', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletError).toBe(true);
      expect(result.current.walletLoading).toBe(false);
      expect(result.current.walletBalance).toBe(0);
    });
  });

  it('flags a non-OK wallet response as an error instead of a zero balance', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletError).toBe(true);
      expect(result.current.walletLoading).toBe(false);
    });
  });

  it('clears the error flag when a later fetch succeeds', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 700 }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.walletError).toBe(true);
    });

    result.current.refreshWallet();

    await waitFor(() => {
      expect(result.current.walletError).toBe(false);
      expect(result.current.walletBalance).toBe(700);
    });
  });

  it('should abort fetch on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((url: string, options?: RequestInit) => {
      capturedSignal = options?.signal as AbortSignal | undefined;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    unmount();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('clears the previous identity wallet state before fetching for a new user', async () => {
    const firstAccount = {
      accountName: 'OGB / JANE ONE',
      accountNumber: '1111111111',
      bankName: 'Wema Bank',
      provider: 'paystack',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance: 900,
        fundingAccount: firstAccount,
        requiresFundingAccountConsent: false,
        walletDvaEnabled: true,
      }),
    });
    // Second identity's fetch never resolves — the stale first-identity
    // account must be cleared without waiting on the network.
    let resolveSecond: (value: unknown) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );

    const { result, rerender } = renderHook(
      ({ userId, merchantSlug }) => useWallet({ userId, merchantSlug }),
      { initialProps: { userId: 'user-1', merchantSlug: 'merchant-1' } }
    );

    await waitFor(() => {
      expect(result.current.fundingAccount).toEqual(firstAccount);
      expect(result.current.walletBalance).toBe(900);
    });

    rerender({ userId: 'user-2', merchantSlug: 'merchant-1' });

    await waitFor(() => {
      expect(result.current.fundingAccount).toBeNull();
      expect(result.current.walletBalance).toBe(0);
      expect(result.current.payWithWallet).toBe(false);
      expect(result.current.walletDvaEnabled).toBe(false);
    });

    resolveSecond({ ok: false });
  });

  it('should refetch when userId changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 500 }),
    });

    const { rerender } = renderHook(
      ({ userId, merchantSlug }) => useWallet({ userId, merchantSlug }),
      { initialProps: { userId: 'user-1', merchantSlug: 'merchant-1' } },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender({ userId: 'user-2', merchantSlug: 'merchant-1' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('should expose the funding account and consent flag from the wallet response', async () => {
    const fundingAccount = {
      accountName: 'OGB / JOHN DOE',
      accountNumber: '9012345678',
      bankName: 'Wema Bank',
      provider: 'paystack',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance: 1500,
        fundingAccount,
        requiresFundingAccountConsent: false,
        walletDvaEnabled: true,
      }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.fundingAccount).toEqual(fundingAccount);
      expect(result.current.requiresFundingAccountConsent).toBe(false);
      expect(result.current.walletDvaEnabled).toBe(true);
    });
  });

  it('should flip the consent flag off when setFundingAccount stores a new account', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance: 0,
        fundingAccount: null,
        requiresFundingAccountConsent: true,
      }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => {
      expect(result.current.requiresFundingAccountConsent).toBe(true);
    });

    const account = {
      accountName: null,
      accountNumber: '9012345678',
      bankName: 'Wema Bank',
      provider: 'paystack',
    };
    await waitFor(() => {
      result.current.setFundingAccount(account);
      expect(result.current.fundingAccount).toEqual(account);
      expect(result.current.requiresFundingAccountConsent).toBe(false);
    });
  });

  it('should refetch when refreshWallet is called', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 500 }),
    });

    const { result } = renderHook(() =>
      useWallet({ userId: 'user-123', merchantSlug: 'test-merchant' }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    result.current.refreshWallet();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('should refetch when merchantSlug changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 500 }),
    });

    const { rerender } = renderHook(
      ({ userId, merchantSlug }) => useWallet({ userId, merchantSlug }),
      { initialProps: { userId: 'user-1', merchantSlug: 'merchant-1' } },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender({ userId: 'user-1', merchantSlug: 'merchant-2' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/storefront/customer/wallet?merchant=merchant-2',
      expect.any(Object),
    );
  });
});
