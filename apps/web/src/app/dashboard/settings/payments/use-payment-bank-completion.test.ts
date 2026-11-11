import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePaymentBankCompletion } from './use-payment-bank-completion';

const merchantA = 'merchant-a';
const merchantB = 'merchant-b';
const savedBank = {
  accountNumber: '1234567890',
  businessName: 'Saved Store',
  merchantId: merchantA,
};

describe('usePaymentBankCompletion', () => {
  it('stores and refreshes a save for the current merchant revision', () => {
    const reloadMerchant = vi.fn();
    const { result } = renderHook(() =>
      usePaymentBankCompletion(merchantA, reloadMerchant)
    );

    act(() =>
      result.current.handleBankSaved(
        merchantA,
        result.current.merchantRevision,
        savedBank
      )
    );

    expect(result.current.savedBank).toEqual(savedBank);
    expect(reloadMerchant).toHaveBeenCalledOnce();
  });

  it('ignores a stale completion when returning to a merchant', () => {
    const reloadMerchant = vi.fn();
    const { result, rerender } = renderHook(
      ({ merchantId }) => usePaymentBankCompletion(merchantId, reloadMerchant),
      { initialProps: { merchantId: merchantA } }
    );
    const firstMerchantARevision = result.current.merchantRevision;

    rerender({ merchantId: merchantB });
    rerender({ merchantId: merchantA });

    act(() =>
      result.current.handleBankSaved(
        merchantA,
        firstMerchantARevision,
        savedBank
      )
    );

    expect(result.current.savedBank).toBeUndefined();
    expect(reloadMerchant).not.toHaveBeenCalled();
  });
});
