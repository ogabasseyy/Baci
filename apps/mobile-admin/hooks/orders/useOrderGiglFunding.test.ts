import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getOrRequestFundingAccount: vi.fn(),
}));

vi.mock('@/lib/order-gigl-shipping', () => ({
  getOrRequestMerchantWalletFundingAccount: api.getOrRequestFundingAccount,
}));

import type { OrderGiglShippingState } from '@/lib/order-gigl-shipping-state';
import { useOrderGiglFunding } from './useOrderGiglFunding';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function useTestFunding(orderId: string, enabled = true) {
  const [state, setState] = useState<OrderGiglShippingState>('idle');
  const [error, setError] = useState<string | null>(null);
  return {
    ...useOrderGiglFunding({ enabled, orderId, setError, setState }),
    error,
    state,
  };
}

describe('useOrderGiglFunding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes an active account and ready state after funding succeeds', async () => {
    const account = {
      accountName: 'BACI / Store',
      accountNumber: '1234567890',
      bankName: 'Wema Bank',
      currency: 'NGN' as const,
      status: 'active' as const,
    };
    api.getOrRequestFundingAccount.mockResolvedValue({
      account,
      status: 'active',
    });
    const { result } = renderHook(() => useTestFunding('order-1'));

    await act(async () => {
      await result.current.startFunding();
    });

    expect(result.current.fundingAccount).toEqual(account);
    expect(result.current.state).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('ignores a stale funding rejection after reset', async () => {
    const request = deferred<{ account: null; status: 'pending' }>();
    api.getOrRequestFundingAccount.mockReturnValue(request.promise);
    const { result } = renderHook(() => useTestFunding('order-1'));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.startFunding();
      result.current.reset();
    });
    request.reject(new Error('old funding failed'));
    await act(async () => {
      await pending;
    });

    expect(result.current.fundingAccount).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('funding');
  });
});
