import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { useWalletRecheckOnPiggyvest } from './use-wallet-recheck-on-piggyvest';

let mockCapability: boolean | null = false;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));

const KEY = ['wallet', 'data', 'merchant-1', 'owner-1'] as const;

// What useWallet passes: the query's current wallet.
function walletOf(queryClient: QueryClient) {
  const read = (queryClient as unknown as { getQueryData?: () => unknown })
    .getQueryData;
  return (read?.() as { wallet?: never } | undefined)?.wallet;
}

function setup(
  initial: boolean | null,
  cachedWallet: Record<string, unknown> | undefined = undefined
) {
  mockCapability = initial;
  const invalidateQueries = jest.fn(async () => undefined);
  const getQueryData = () =>
    cachedWallet ? { transactions: [], wallet: cachedWallet } : undefined;
  const queryClient = {
    getQueryData,
    invalidateQueries,
  } as unknown as QueryClient;
  const hook = renderHook(() =>
    useWalletRecheckOnPiggyvest(
      queryClient,
      'merchant-1',
      KEY,
      walletOf(queryClient)
    )
  );
  return { hook, invalidateQueries };
}

describe('bugfix: cached legacy wallet kept after the server enables PiggyVest', () => {
  it('refetches the cached wallet when the capability turns from false to true', () => {
    // Arrange: wallet cached while the server ruled PiggyVest out.
    const { hook, invalidateQueries } = setup(false);

    // Act: the negative verdict expires and the server now enables it.
    mockCapability = true;
    hook.rerender({});

    // Assert
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: KEY,
      exact: true,
    });
  });

  it('refetches when a ruled-out verdict becomes unknown again', () => {
    const { hook, invalidateQueries } = setup(false);
    mockCapability = null;
    hook.rerender({});
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

describe('wallet recheck with the server keeping PiggyVest off', () => {
  it('never refetches while the capability stays false', () => {
    const { hook, invalidateQueries } = setup(false);
    hook.rerender({});
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('does not refetch on a probe that confirms an already-PiggyVest wallet', () => {
    const { hook, invalidateQueries } = setup(null, {
      balance: 0,
      primary_balance_kobo: 0,
    });
    mockCapability = true;
    hook.rerender({});
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('bugfix: legacy wallet restored after a cold restart stays authoritative', () => {
  it('refetches on the first positive verdict when the cached wallet is legacy', () => {
    // Arrange: cold start; the persisted cache restores a wallet saved while
    // PiggyVest was ruled out, and the capability starts unknown.
    const { hook, invalidateQueries } = setup(null, { balance: 0 });

    // Act: the first probe answers that PiggyVest is enabled.
    mockCapability = true;
    hook.rerender({});

    // Assert
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: KEY,
      exact: true,
    });
  });

  it('does not refetch when the first verdict rules PiggyVest out', () => {
    const { hook, invalidateQueries } = setup(null, { balance: 0 });
    mockCapability = false;
    hook.rerender({});
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('bugfix: account switch restores a legacy wallet while PiggyVest is on', () => {
  it('refetches when the wallet scope changes onto a cached legacy wallet', () => {
    // Arrange: PiggyVest already confirmed; the next account's wallet is
    // still cached in the plain legacy shape.
    mockCapability = true;
    const invalidateQueries = jest.fn(async () => undefined);
    const queryClient = {
      getQueryData: () => ({ transactions: [], wallet: { balance: 0 } }),
      invalidateQueries,
    } as unknown as QueryClient;
    const OTHER = ['wallet', 'data', 'merchant-1', 'owner-2'] as const;
    const hook = renderHook(
      ({ key }: { key: readonly string[] }) =>
        useWalletRecheckOnPiggyvest(
          queryClient,
          'merchant-1',
          key,
          walletOf(queryClient)
        ),
      { initialProps: { key: KEY as readonly string[] } }
    );

    // Act: another account signs in.
    hook.rerender({ key: OTHER });

    // Assert
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: OTHER,
      exact: true,
    });
  });

  it('does not refetch a new scope that already reads as PiggyVest', () => {
    mockCapability = true;
    const invalidateQueries = jest.fn(async () => undefined);
    const queryClient = {
      getQueryData: () => ({
        transactions: [],
        wallet: { balance: 0, primary_balance_kobo: 0 },
      }),
      invalidateQueries,
    } as unknown as QueryClient;
    const hook = renderHook(
      ({ key }: { key: readonly string[] }) =>
        useWalletRecheckOnPiggyvest(
          queryClient,
          'merchant-1',
          key,
          walletOf(queryClient)
        ),
      { initialProps: { key: KEY as readonly string[] } }
    );

    hook.rerender({ key: ['wallet', 'data', 'merchant-1', 'owner-2'] });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('bugfix: persisted wallet restored after the positive verdict', () => {
  it('refetches when a legacy wallet lands in the cache after PiggyVest is confirmed', () => {
    // Arrange: the probe answers before the persisted cache is restored.
    mockCapability = true;
    let cached: unknown;
    const invalidateQueries = jest.fn(async () => undefined);
    const queryClient = {
      getQueryData: () => cached,
      invalidateQueries,
    } as unknown as QueryClient;
    const hook = renderHook(() =>
      useWalletRecheckOnPiggyvest(
        queryClient,
        'merchant-1',
        KEY,
        walletOf(queryClient)
      )
    );
    expect(invalidateQueries).not.toHaveBeenCalled();

    // Act: the restore inserts a still-fresh legacy-shaped wallet.
    cached = { transactions: [], wallet: { balance: 0 } };
    hook.rerender({});

    // Assert
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: KEY,
      exact: true,
    });
  });
});
