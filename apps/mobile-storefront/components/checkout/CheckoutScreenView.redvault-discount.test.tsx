import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockStepActionInputs: Array<{ appliedDiscountCode: string | null }> = [];

jest.mock('@/components/checkout/CheckoutBottomAction', () => ({
  CheckoutBottomAction: ({ displayTotal }: { displayTotal: number }) => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>Displayed total: {displayTotal}</Text>;
  },
}));

jest.mock('@/components/checkout/CheckoutHeader', () => ({
  CheckoutHeader: () => null,
}));

jest.mock('@/components/checkout/CheckoutStepper', () => ({
  CheckoutStepper: () => null,
}));

jest.mock('@/components/storefront/PatternedBackground', () => ({
  PatternedBackground: () => null,
}));

jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/ui/address-suggestions-portal', () => ({
  AddressSuggestionsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => ({ customer: null, isAuthenticated: false, user: null }),
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => ({ data: null }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('./CheckoutLocationPickerOverlays', () => ({
  CheckoutLocationPickerOverlays: () => null,
}));

jest.mock('./CheckoutPaymentOverlays', () => ({
  CheckoutPaymentOverlays: () => null,
}));

jest.mock('./CheckoutStepContent', () => ({
  CheckoutStepContent: ({
    paymentController,
  }: {
    paymentController: {
      setSelectedPayment: (method: 'paystack' | 'uba_redvault') => void;
    };
  }) => {
    const { Pressable, Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <>
        <Pressable
          accessibilityRole="button"
          onPress={() => paymentController.setSelectedPayment('uba_redvault')}
        >
          <Text>Pay with UBA</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => paymentController.setSelectedPayment('paystack')}
        >
          <Text>Paystack</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock('./checkout-order-builders', () => ({
  calculateCheckoutAssuranceFee: () => 0,
}));

jest.mock('./merchant-pickup-location', () => ({
  getMerchantPickupLocation: () => undefined,
}));

jest.mock('./redvault/CheckoutDiscount', () => ({
  CheckoutDiscount: ({
    onChange,
  }: {
    onChange: (discount: { code: string; discountAmount: number }) => void;
  }) => {
    const { Pressable, Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange({ code: 'WELCOME10', discountAmount: 1_000 })}
      >
        <Text>Apply ordinary discount</Text>
      </Pressable>
    );
  },
}));

jest.mock('./redvault/RedvaultOrderReview', () => ({
  RedvaultOrderReview: () => null,
}));

jest.mock('./use-checkout-address-state', () => ({
  useCheckoutAddressState: () => ({
    accountPassword: '',
    form: { handleSubmit: jest.fn(), setValue: jest.fn() },
    hasContactIdentity: true,
    isAddressComplete: true,
    saveDetails: jest.fn(),
    savedAddresses: {
      defaultSavedAddress: null,
      setIsContactCollapsed: jest.fn(),
      setIsDeliveryCollapsed: jest.fn(),
      selectedSavedAddressId: null,
    },
    shipping: {
      currentShippingQuoteContextKey: null,
      deliveryFee: 0,
      deliveryMethod: 'pickup',
      getShippingProvider: jest.fn(),
      isCurrentQuoteContext: true,
      isLoadingQuotes: false,
      requiresShippingQuote: false,
      resolvedShippingQuoteContextKey: null,
      selectedQuote: null,
    },
    watchedCity: '',
    watchedState: '',
  }),
}));

jest.mock('./use-checkout-crypto-payment', () => ({
  useCheckoutCryptoPayment: () => ({
    cryptoPayment: null,
    handleCryptoConfirm: jest.fn(),
    setPendingOrder: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    showCryptoSelection: false,
  }),
}));

jest.mock('./use-checkout-cta-animation', () => ({
  useCheckoutCtaAnimation: () => ({}),
}));

jest.mock('./use-checkout-display-cart', () => ({
  useCheckoutDisplayCart: () => ({
    clearCart: jest.fn(),
    items: [],
    subtotal: 0,
  }),
}));

jest.mock('./use-checkout-navigation', () => ({
  useCheckoutNavigation: () => ({ handleBack: jest.fn() }),
}));

jest.mock('./use-checkout-payment-controller', () => ({
  useCheckoutPaymentController: () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const [selectedPayment, setSelectedPayment] = React.useState<
      'paystack' | 'uba_redvault'
    >('paystack');
    return {
      availablePaymentMethods: ['paystack', 'uba_redvault'],
      displayTotal: 5_000,
      orderTotals: null,
      paymentSettings: null,
      paymentTab: 'full',
      redvaultAvailable: true,
      resetPaymentSelection: jest.fn(),
      savings: { getLiveSavingsSelection: jest.fn() },
      selectedPayment,
      setSelectedPayment,
      total: 5_000,
      walletBalance: 0,
      walletFundedBankTransferOptionEnabled: false,
      walletSelection: undefined,
    };
  },
}));

jest.mock('./use-checkout-step-actions', () => ({
  useCheckoutStepActions: (input: { appliedDiscountCode: string | null }) => {
    mockStepActionInputs.push({
      appliedDiscountCode: input.appliedDiscountCode,
    });
    return { handleContinue: jest.fn(), handlePlaceOrder: jest.fn() };
  },
}));

import { CheckoutScreenView } from './CheckoutScreenView';

describe('bugfix: REDVAULT checkout discount wiring', () => {
  beforeEach(() => {
    mockStepActionInputs.length = 0;
  });

  it('removes a previously applied ordinary discount from both REDVAULT totals and the submit payload, then restores it after switching back', () => {
    render(<CheckoutScreenView />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Apply ordinary discount' })
    );
    expect(screen.getByText('Displayed total: 4000')).toBeTruthy();
    expect(mockStepActionInputs.at(-1)).toEqual({
      appliedDiscountCode: 'WELCOME10',
    });

    fireEvent.press(screen.getByRole('button', { name: 'Pay with UBA' }));
    expect(screen.getByText('Displayed total: 5000')).toBeTruthy();
    expect(mockStepActionInputs.at(-1)).toEqual({ appliedDiscountCode: null });

    fireEvent.press(screen.getByRole('button', { name: 'Paystack' }));
    expect(screen.getByText('Displayed total: 4000')).toBeTruthy();
    expect(mockStepActionInputs.at(-1)).toEqual({
      appliedDiscountCode: 'WELCOME10',
    });
  });
});
