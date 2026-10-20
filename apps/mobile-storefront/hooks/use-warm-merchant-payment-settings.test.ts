import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

const mockReconcile = jest.fn();
const mockIsRestored = jest.fn();
let mockSettingsData: { shipping_insurance_enabled: boolean } | undefined;
let mockDataUpdatedAt = Date.now();

jest.mock('./useMerchantPaymentSettings', () => ({
  MERCHANT_PAYMENT_SETTINGS_STALE_MS: 5 * 60 * 1000,
  useMerchantPaymentSettings: () => ({
    data: mockSettingsData,
    dataUpdatedAt: mockDataUpdatedAt,
  }),
}));
jest.mock('@/stores/cart-assurance-config', () => ({
  isRestoredPaymentSettingsData: (...args: unknown[]) =>
    mockIsRestored(...args),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: object) => unknown) =>
    selector({ reconcilePendingAssuranceLines: mockReconcile }),
}));

import { useWarmMerchantPaymentSettings } from './use-warm-merchant-payment-settings';

describe('useWarmMerchantPaymentSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsData = undefined;
    mockDataUpdatedAt = Date.now();
    // Network-fresh by default; restore cases opt in per test.
    mockIsRestored.mockReturnValue(false);
  });

  it('reconciles pending lines once the settings load', () => {
    const { rerender } = renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).not.toHaveBeenCalled();

    mockSettingsData = { shipping_insurance_enabled: true };
    rerender({});

    expect(mockReconcile).toHaveBeenCalledWith(true);
  });

  it('still reconciles (to clear pending flags) when the setting is off', () => {
    mockSettingsData = { shipping_insurance_enabled: false };
    renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).toHaveBeenCalledWith(false);
  });

  it('skips reconciliation while the value is a stale persisted restore', () => {
    mockSettingsData = { shipping_insurance_enabled: true };
    mockDataUpdatedAt = Date.now() - 24 * 60 * 60 * 1000;
    const { rerender } = renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).not.toHaveBeenCalled();

    mockDataUpdatedAt = Date.now();
    rerender({});

    expect(mockReconcile).toHaveBeenCalledWith(true);
  });

  it('skips a fresh restore and reconciles once the network value lands', () => {
    mockSettingsData = { shipping_insurance_enabled: true };
    mockIsRestored.mockReturnValue(true);
    const { rerender } = renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockIsRestored).toHaveBeenCalledWith(mockDataUpdatedAt);

    mockIsRestored.mockReturnValue(false);
    // Distinct from the pre-render stamp: the same millisecond would leave
    // the effect deps unchanged and the reconcile would never re-run.
    mockDataUpdatedAt += 1;
    rerender({});

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledWith(true);
  });

  it('reconciles once per loaded value but again on a newer load', () => {
    mockSettingsData = { shipping_insurance_enabled: true };
    const { rerender } = renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).toHaveBeenCalledTimes(1);

    // Same loaded value re-rendered: no duplicate reconcile.
    rerender({});

    expect(mockReconcile).toHaveBeenCalledTimes(1);

    // A newer network load reconciles lines stamped pending since.
    mockDataUpdatedAt = Date.now() + 1000;
    rerender({});

    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });
});
