import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

const mockReconcile = jest.fn();
let mockSettingsData: { shipping_insurance_enabled: boolean } | undefined;
let mockDataUpdatedAt = Date.now();

jest.mock('./useMerchantPaymentSettings', () => ({
  MERCHANT_PAYMENT_SETTINGS_STALE_MS: 5 * 60 * 1000,
  useMerchantPaymentSettings: () => ({
    data: mockSettingsData,
    dataUpdatedAt: mockDataUpdatedAt,
  }),
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

  it('reconciles at most once per mount even across refetches', () => {
    mockSettingsData = { shipping_insurance_enabled: true };
    const { rerender } = renderHook(() => useWarmMerchantPaymentSettings());

    expect(mockReconcile).toHaveBeenCalledTimes(1);

    mockDataUpdatedAt = Date.now();
    rerender({});

    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});
