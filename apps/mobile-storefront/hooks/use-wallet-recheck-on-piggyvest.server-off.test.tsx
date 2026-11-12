import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { useWalletRecheckOnPiggyvest } from './use-wallet-recheck-on-piggyvest';

let mockCapability: boolean | null = false;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));

const KEY = ['wallet', 'data', 'merchant-1', 'owner-1'] as const;

function setup(initial: boolean | null) {
  mockCapability = initial;
  const invalidateQueries = jest.fn(async () => undefined);
  const queryClient = { invalidateQueries } as unknown as QueryClient;
  const hook = renderHook(() =>
    useWalletRecheckOnPiggyvest(queryClient, 'merchant-1', KEY)
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

  it('does not refetch on a probe that confirms an already-possible merchant', () => {
    const { hook, invalidateQueries } = setup(null);
    mockCapability = true;
    hook.rerender({});
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
