import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useStartSavingsPaymentMethods } from './use-start-savings-payment-methods';

const mockListCustomerPaymentMethods =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

const savedCard = {
  bank: 'Access Bank',
  brand: 'visa',
  exp_month: '08',
  exp_year: '2030',
  id: 'card-1',
  is_default: true,
  label: 'Access Bank ending 1234',
  last4: '1234',
  provider: 'paystack',
};

jest.mock('@/lib/customer-savings', () => ({
  listCustomerPaymentMethods: (...args: unknown[]) =>
    mockListCustomerPaymentMethods(...args),
}));

describe('useStartSavingsPaymentMethods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListCustomerPaymentMethods.mockResolvedValue([savedCard]);
  });

  it('clears previous merchant selection immediately and ignores a cancelled old response', async () => {
    let finishOld: (value: unknown[]) => void = () => undefined;
    let failCurrent: (reason: Error) => void = () => undefined;
    const oldRequest = new Promise<unknown[]>((resolve) => {
      finishOld = resolve;
    });
    const currentRequest = new Promise<unknown[]>((_resolve, reject) => {
      failCurrent = reject;
    });
    const { result, rerender } = renderHook(
      ({ merchantId }: { merchantId: string }) =>
        useStartSavingsPaymentMethods({
          activeMerchantId: merchantId,
          sourceMode: 'auto_debit',
        }),
      { initialProps: { merchantId: 'merchant-1' } }
    );
    await waitFor(() =>
      expect(result.current.savedPaymentMethods).toHaveLength(1)
    );
    act(() => {
      result.current.setSelectedPaymentMethodId(savedCard.id);
    });
    mockListCustomerPaymentMethods
      .mockReturnValueOnce(oldRequest)
      .mockReturnValueOnce(currentRequest);
    rerender({ merchantId: 'merchant-2' });
    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(result.current.selectedPaymentMethodId).toBeNull();
    rerender({ merchantId: 'merchant-3' });
    await act(async () => {
      finishOld([savedCard]);
      await oldRequest;
    });
    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(result.current.isLoadingPaymentMethods).toBe(true);
    await act(async () => {
      failCurrent(new Error('Synthetic read failure'));
      await currentRequest.catch(() => undefined);
    });
    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(result.current.selectedPaymentMethodId).toBeNull();
    expect(result.current.paymentMethodsError).toBe('Synthetic read failure');
  });

  it('does not load cards until auto-debit is selected', () => {
    const { result } = renderHook(() =>
      useStartSavingsPaymentMethods({
        activeMerchantId: 'merchant-1',
        activeMerchantSlug: 'ogabassey',
        sourceMode: 'manual',
      })
    );

    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(mockListCustomerPaymentMethods).not.toHaveBeenCalled();
  });

  it('clears saved-card state when switching away from auto-debit', async () => {
    const { result, rerender } = renderHook(
      ({ sourceMode }: { sourceMode: 'auto_debit' | 'manual' }) =>
        useStartSavingsPaymentMethods({
          activeMerchantId: 'merchant-1',
          activeMerchantSlug: 'ogabassey',
          sourceMode,
        }),
      {
        initialProps: { sourceMode: 'auto_debit' as const },
      }
    );

    await waitFor(() =>
      expect(result.current.savedPaymentMethods).toHaveLength(1)
    );

    act(() => {
      result.current.setSelectedPaymentMethodId('card-1');
      rerender({ sourceMode: 'manual' });
    });

    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(result.current.selectedPaymentMethodId).toBeNull();
    expect(result.current.paymentMethodsError).toBeNull();
    expect(result.current.isLoadingPaymentMethods).toBe(false);
  });

  it('loads saved cards for auto-debit and keeps valid selected card', async () => {
    const { result } = renderHook(() =>
      useStartSavingsPaymentMethods({
        activeMerchantId: 'merchant-1',
        activeMerchantSlug: 'ogabassey',
        sourceMode: 'auto_debit',
      })
    );

    await waitFor(() =>
      expect(result.current.savedPaymentMethods).toHaveLength(1)
    );

    expect(mockListCustomerPaymentMethods).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(result.current.paymentMethodsError).toBeNull();
    expect(result.current.isLoadingPaymentMethods).toBe(false);
  });

  it('loads an empty saved-card list for auto-debit', async () => {
    mockListCustomerPaymentMethods.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useStartSavingsPaymentMethods({
        activeMerchantId: 'merchant-1',
        activeMerchantSlug: 'ogabassey',
        sourceMode: 'auto_debit',
      })
    );

    await waitFor(() =>
      expect(result.current.isLoadingPaymentMethods).toBe(false)
    );

    expect(result.current.savedPaymentMethods).toEqual([]);
    expect(result.current.selectedPaymentMethodId).toBeNull();
  });

  it('clears the selected card when a later load no longer includes it', async () => {
    const { result, rerender } = renderHook(
      ({ activeMerchantId }: { activeMerchantId: string }) =>
        useStartSavingsPaymentMethods({
          activeMerchantId,
          activeMerchantSlug: 'ogabassey',
          sourceMode: 'auto_debit',
        }),
      {
        initialProps: { activeMerchantId: 'merchant-1' },
      }
    );

    await waitFor(() =>
      expect(result.current.savedPaymentMethods).toHaveLength(1)
    );
    act(() => {
      result.current.setSelectedPaymentMethodId('card-1');
    });
    expect(result.current.selectedPaymentMethodId).toBe('card-1');

    mockListCustomerPaymentMethods.mockResolvedValue([
      { ...savedCard, id: 'card-2', label: 'Access Bank ending 5678' },
    ]);
    rerender({ activeMerchantId: 'merchant-2' });

    await waitFor(() =>
      expect(result.current.savedPaymentMethods[0]?.id).toBe('card-2')
    );
    expect(result.current.selectedPaymentMethodId).toBeNull();
  });

  it('does not update state after unmounting during saved-card load', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let resolveMethods: (methods: unknown[]) => void = () => undefined;
    const pendingMethods = new Promise<unknown[]>((resolve) => {
      resolveMethods = resolve;
    });
    mockListCustomerPaymentMethods.mockReturnValueOnce(pendingMethods);
    const { unmount } = renderHook(() =>
      useStartSavingsPaymentMethods({
        activeMerchantId: 'merchant-1',
        activeMerchantSlug: 'ogabassey',
        sourceMode: 'auto_debit',
      })
    );

    unmount();
    await act(async () => {
      resolveMethods([savedCard]);
      await pendingMethods;
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('surfaces saved-card loading errors', async () => {
    mockListCustomerPaymentMethods.mockRejectedValue(
      new Error('Paystack down')
    );

    const { result } = renderHook(() =>
      useStartSavingsPaymentMethods({
        sourceMode: 'auto_debit',
      })
    );

    await waitFor(() =>
      expect(result.current.paymentMethodsError).toBe('Paystack down')
    );
    expect(result.current.isLoadingPaymentMethods).toBe(false);
  });
});
