import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: jest.fn(),
    isKeyboardVisible: false,
    keyboardHeight: 0,
  }),
}));

jest.mock('@/hooks/use-utility-payment', () => ({
  useUtilityPayment: () => ({
    cards: [],
    selectedGateway: 'paystack',
    supportedGateways: ['paystack'],
  }),
}));

jest.mock('@/stores/auth-store', () => {
  const useAuthStore = Object.assign(
    (selector: (state: { customer: null }) => unknown) =>
      selector({ customer: null }),
    // The wallet pay hand-over reads the signed-in account directly.
    { getState: () => ({ user: null }) }
  );
  return { useAuthStore };
});

jest.mock('./use-airtime-purchase-handler', () => ({
  useAirtimePurchaseHandler: () => ({
    handlePurchase: jest.fn(),
    isSubmitting: false,
  }),
}));

import { useAirtimeFormController } from './use-airtime-form-controller';

describe('useAirtimeFormController', () => {
  it('derives a prefilled wallet returnTo href from the form inputs', () => {
    const { result } = renderHook(() =>
      useAirtimeFormController({ onSuccess: jest.fn() })
    );

    act(() => {
      result.current.handlePhoneChange('08031234567');
      result.current.setAmount('500');
    });

    expect(result.current.walletReturnToHref).toContain('/utilities/airtime?');
    expect(result.current.walletReturnToHref).toContain('repeatAmount=500');
    expect(result.current.walletReturnToHref).toContain(
      'repeatPhoneNumber=08031234567'
    );
  });

  it('returns a bare airtime href when the form is still empty', () => {
    const { result } = renderHook(() =>
      useAirtimeFormController({ onSuccess: jest.fn() })
    );

    expect(result.current.walletReturnToHref).toBe('/utilities/airtime');
  });
});
