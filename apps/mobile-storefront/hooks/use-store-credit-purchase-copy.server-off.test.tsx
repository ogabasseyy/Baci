import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useStoreCreditPurchaseCopy } from './use-store-credit-purchase-copy';

let mockVerdict: boolean | null = null;
jest.mock('./use-piggyvest-capability-now', () => ({
  usePiggyvestCapabilityNow: () => mockVerdict,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

const primaryWallet = { primary_balance_kobo: 500_000 };

describe('bugfix: IMEI says "store credit" after a rollback with a failed reload', () => {
  it('drops the store-credit wording while PiggyVest is ruled out', () => {
    mockVerdict = false;
    const { result } = renderHook(() =>
      useStoreCreditPurchaseCopy('merchant-1', primaryWallet)
    );
    expect(result.current).toBe(false);
  });

  it('keeps it for a PiggyVest wallet while PiggyVest is on or unknown', () => {
    mockVerdict = true;
    const on = renderHook(() =>
      useStoreCreditPurchaseCopy('merchant-1', primaryWallet)
    );
    expect(on.result.current).toBe(true);
    mockVerdict = null;
    const unknown = renderHook(() =>
      useStoreCreditPurchaseCopy('merchant-1', primaryWallet)
    );
    expect(unknown.result.current).toBe(true);
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps the wallet wording for a legacy wallet', () => {
    mockVerdict = false;
    const { result } = renderHook(() =>
      useStoreCreditPurchaseCopy('merchant-1', {})
    );
    expect(result.current).toBe(false);
  });
});
