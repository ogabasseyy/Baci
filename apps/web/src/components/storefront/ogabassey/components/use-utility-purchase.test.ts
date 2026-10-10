import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Customer,
  CustomerUser,
} from '@/contexts/customer-auth-context';
import { useUtilityPurchase } from './use-utility-purchase';

const mockSubmit = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('./utility-checkout-submit', () => ({
  submitUtilityCheckout: mockSubmit,
}));
vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));

const customer = {
  id: 'customer-1',
  first_name: 'Test',
  last_name: 'Customer',
  email: 'customer@example.com',
  phone: '08012345678',
} as unknown as Customer;

const user = {
  id: 'user-1',
  email: 'customer@example.com',
  role: 'customer',
} as unknown as CustomerUser;

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'airtime' as const,
    clearIntent: vi.fn(),
    customer,
    isAuthLoading: false,
    isAuthenticated: true,
    merchantSlug: 'ogabassey',
    setWalletBalance: vi.fn(),
    user,
    walletBalance: 5000,
    ...overrides,
  };
}

const airtime = {
  amount: 1000,
  networkProvider: 'MTN',
  phoneNumber: '08012345678',
};

describe('useUtilityPurchase', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockToast.mockReset();
  });

  it('blocks checkout and prompts sign-in when the customer is not authenticated', async () => {
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ isAuthenticated: false, user: null }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sign in required' })
    );
    expect(result.current.step).toBe('details');
  });

  it('waits (does not submit) while the auth session is still loading', async () => {
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ isAuthLoading: true }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking account' })
    );
  });

  it('completes a wallet purchase: clears the draft, debits the balance, shows success', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF123',
      amount: 1000,
      processing: false,
    });
    const clearIntent = vi.fn();
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ clearIntent, setWalletBalance }))
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() => expect(result.current.step).toBe('success'));
    expect(clearIntent).toHaveBeenCalledTimes(1);
    expect(result.current.transactionRef).toBe('REF123');
    expect(result.current.successAmount).toBe(1000);
    // Balance is debited via a functional update (5000 - 1000).
    const updater = setWalletBalance.mock.calls[0][0] as (n: number) => number;
    expect(updater(5000)).toBe(4000);
  });

  it('blocks checkout without a network call when the wallet cannot cover the bill', async () => {
    const onInsufficientWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(
        baseParams({ onInsufficientWalletBalance, walletBalance: 500 })
      )
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient wallet balance' })
    );
    expect(onInsufficientWalletBalance).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('details');
    expect(result.current.loading).toBe(false);
  });

  it('surfaces an error toast and stays on the form when checkout fails', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'error',
      message: 'Insufficient funds',
    });
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Transaction Failed',
          description: 'Insufficient funds',
          variant: 'destructive',
        })
      )
    );
    expect(result.current.step).toBe('details');
  });
});
