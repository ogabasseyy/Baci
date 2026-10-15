import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

const mockReconcile = jest.fn();
let mockSettingsData: { shipping_insurance_enabled: boolean } | undefined;

jest.mock('./useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => ({ data: mockSettingsData }),
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
});
