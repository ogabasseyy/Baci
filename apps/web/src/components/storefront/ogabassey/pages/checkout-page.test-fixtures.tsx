import { vi } from 'vitest';

const addressAutocompleteMock = vi.hoisted(() => ({
  selectedPlace: null as null | {
    city: string;
    formattedAddress: string;
    location: { latitude: number; longitude: number };
    state: string;
  },
}));

// Mock all heavy dependencies before importing the component
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('@/lib/feature-flags', () => ({
  hasPriceNegotiationEntitlement: vi.fn(() => true),
}));

const mockCaptureClientEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: mockCaptureClientEvent,
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    cart: [],
    cartTotal: 0,
    clearCart: vi.fn(),
    isHydrated: true,
  })),
}));

const mockCaptureCheckoutFunnelEventOnce = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: mockCaptureCheckoutFunnelEventOnce,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
    },
    basePath: '/ogabassey',
  })),
}));

vi.mock('./checkout/hooks/use-checkout-form-state', async () => {
  const { useCheckoutFormTestState } = await import(
    './checkout/checkout-form-state.test-support'
  );
  return { useCheckoutFormState: useCheckoutFormTestState };
});

vi.mock('@/hooks/use-persisted-state', () => ({
  usePersistedForm: vi.fn(() => ({
    values: {
      firstName: '',
      lastName: '',
      customerEmail: '',
      customerPhone: '',
      newAddressStreet: '',
      newAddressState: '',
      newAddressCity: '',
      currentStep: 'contact',
      completedSteps: { contact: false, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  })),
  usePersistedState: vi.fn(() => [null, vi.fn(), vi.fn()]),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: vi.fn(() => null),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
  calculateCommerce: vi.fn().mockResolvedValue({
    total: 10000,
    taxAmount: 750,
  }),
}));

vi.mock('@/components/ui/phone-input', () => ({
  PhoneInput: vi.fn(({ value, onChange, ...props }) => (
    <input
      data-testid="phone-input"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    />
  )),
}));

vi.mock('@/components/storefront/checkout-auth-modal', () => ({
  CheckoutAuthModal: vi.fn(() => null),
}));

vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: vi.fn(
    ({ value, onChange, onChangeText, onSelect, ...props }) => (
      <>
        <input
          data-testid="address-input"
          value={value || ''}
          onChange={(e) => {
            onChange?.(e);
            onChangeText?.(e.target.value);
          }}
          {...props}
        />
        {addressAutocompleteMock.selectedPlace && (
          <button
            data-testid="select-address-place"
            type="button"
            onClick={() => onSelect?.(addressAutocompleteMock.selectedPlace)}
          >
            Select address place
          </button>
        )}
      </>
    )
  ),
}));

vi.mock('@/lib/credpal', () => ({
  getCredPalKey: vi.fn(() => 'pk_test_credpal'),
  openCredPalCheckout: vi.fn(),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: vi.fn(),
}));

const walletFundedTransferMock = vi.hoisted(() => ({
  start: vi.fn(async () => 'fallback' as const),
  onOrderPaid: null as null | ((payload: Record<string, unknown>) => void),
}));

vi.mock('./checkout/hooks/use-wallet-funded-bank-transfer', () => ({
  useWalletFundedBankTransfer: (args: {
    onOrderPaid: (payload: Record<string, unknown>) => void;
  }) => {
    walletFundedTransferMock.onOrderPaid = args.onOrderPaid;
    return {
      account: null,
      acceptConsent: vi.fn(),
      checkNow: vi.fn(),
      close: vi.fn(),
      consentRequested: false,
      declineConsent: vi.fn(),
      error: null,
      intent: null,
      isChecking: false,
      start: walletFundedTransferMock.start,
    };
  },
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: vi.fn((path: string) => path),
}));

vi.mock('react-phone-number-input', () => ({
  isValidPhoneNumber: vi.fn(() => true),
}));

vi.mock('../components/SmartQuoteLoader', () => ({
  SmartQuoteLoader: vi.fn(() => null),
}));

vi.mock('../components/PaymentLogos', () => ({
  PaystackLogo: vi.fn(() => null),
  KorapayLogo: vi.fn(() => null),
  CredPalLogo: vi.fn(() => null),
  CreditDirectLogo: vi.fn(() => null),
  JuicywayLogo: vi.fn(() => null),
  BankTransferLogo: vi.fn(() => null),
}));

vi.mock('../components/MobileCheckoutComponents', () => ({
  MobileOrderSummary: vi.fn(() => null),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

export {
  addressAutocompleteMock,
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
  walletFundedTransferMock,
};
