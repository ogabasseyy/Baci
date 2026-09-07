import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the mock surface of checkout-page.test.tsx — the page pulls in the
// whole storefront shell, so every heavy dependency is stubbed.
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('@/lib/feature-flags', () => ({
  hasPriceNegotiationEntitlement: vi.fn(() => true),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 5000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 5000,
    clearCart: vi.fn(),
    isHydrated: true,
  })),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      paystack_subaccount_code: 'ACCT_test',
      vat_registration_status: 'not_registered',
      feature_settings: {
        paystack_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    },
    basePath: '/ogabassey',
  })),
}));

vi.mock('./checkout/hooks/use-checkout-form-state', async () => {
  const { useCheckoutFormTestState } = await import('./checkout/checkout-form-state.test-support');
  return { useCheckoutFormState: useCheckoutFormTestState };
});

vi.mock('@/hooks/use-persisted-state', () => ({
  usePersistedForm: vi.fn(() => ({
    values: {
      firstName: 'Ada',
      lastName: 'Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      newAddressStreet: '2 Olaide Tomori Street',
      newAddressState: 'Lagos',
      newAddressCity: 'Ikeja',
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  })),
  usePersistedState: vi.fn(() => [null, vi.fn(), vi.fn()]),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: vi.fn(() => ({
    user: { id: 'user-1', email: 'ada@example.com', user_metadata: {} },
  })),
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
  calculateCommerce: vi.fn().mockResolvedValue({ total: 5000, taxAmount: 0 }),
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
  AddressAutocomplete: vi.fn(({ value, onChange, onChangeText, ...props }) => (
    <input
      data-testid="address-input"
      value={value || ''}
      onChange={(e) => {
        onChange?.(e);
        onChangeText?.(e.target.value);
      }}
      {...props}
    />
  )),
}));

vi.mock('@/lib/credpal', () => ({
  getCredPalKey: vi.fn(() => 'pk_test_credpal'),
  openCredPalCheckout: vi.fn(),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: vi.fn(),
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

import { useAuthSafe } from '@/contexts/auth-context';
import { toast } from '@/hooks/use-toast';
import {
  called,
  FLAG,
  INTENTS_URL,
  placeBankTransferOrder,
  stubFetch,
} from './checkout-page.wallet-funded.support';

const SIGNED_IN = {
  user: { id: 'user-1', email: 'ada@example.com', user_metadata: {} },
} as unknown as ReturnType<typeof useAuthSafe>;

describe('CheckoutPage — wallet-funded bank transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The merchant AuthContext prefills the form, but it is NOT the gate source:
    // the checkout route mounts no AuthProvider, so the flow keys off the cookie
    // session (`/api/storefront/auth/session`) that `stubFetch` drives instead.
    vi.mocked(useAuthSafe).mockReturnValue(SIGNED_IN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a complete no-op when the flag is off: signed-in customers still mint an order DVA', async () => {
    vi.stubEnv(FLAG, '');
    const fetchMock = stubFetch();

    await placeBankTransferOrder();

    await waitFor(() => {
      expect(called(fetchMock, '/api/payments/initialize')).toBe(true);
    });
    expect(called(fetchMock, INTENTS_URL)).toBe(false);
  });

  it('keeps guests on the order-DVA path even with the flag on', async () => {
    vi.stubEnv(FLAG, 'true');
    // The signed-in merchant context is left in place on purpose: the gate must
    // key off the guest cookie session, proving it does not trust `useAuthSafe`.
    const fetchMock = stubFetch({ sessionAuthenticated: false });

    await placeBankTransferOrder();

    await waitFor(() => {
      expect(called(fetchMock, '/api/payments/initialize')).toBe(true);
    });
    expect(called(fetchMock, INTENTS_URL)).toBe(false);
  });

  it('falls back to the order-DVA path when the merchant has auto-debit disabled', async () => {
    vi.stubEnv(FLAG, 'true');
    const fetchMock = stubFetch({
      intentResponse: {
        body: { code: 'WALLET_ORDER_AUTO_DEBIT_DISABLED', kind: 'fallback' },
        status: 403,
      },
    });

    await placeBankTransferOrder();

    await waitFor(() => {
      expect(called(fetchMock, INTENTS_URL)).toBe(true);
    });
    await waitFor(() => {
      expect(called(fetchMock, '/api/payments/initialize')).toBe(true);
    });
  });

  it('does NOT open the legacy order-DVA path when the intent POST is indeterminate (5xx)', async () => {
    // Money-safety: a 5xx create means the server may already hold a funding
    // intent for this order. Opening the legacy `/api/payments/initialize` DVA
    // would be a SECOND funding channel (double-charge / split-order risk). The
    // checkout must stop and warn — never fall back.
    vi.stubEnv(FLAG, 'true');
    const fetchMock = stubFetch({
      intentResponse: {
        body: { code: 'server_error', error: 'boom' },
        status: 502,
      },
    });

    await placeBankTransferOrder();

    await waitFor(() => {
      expect(called(fetchMock, INTENTS_URL)).toBe(true);
    });
    await waitFor(() => {
      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      );
    });
    // The legacy DVA path must never be reached on an indeterminate outcome.
    expect(called(fetchMock, '/api/payments/initialize')).toBe(false);
  });

  it('shows the wallet account number and never mints an order DVA when the intent opens', async () => {
    vi.stubEnv(FLAG, 'true');
    const fetchMock = stubFetch();

    await placeBankTransferOrder();

    expect(await screen.findByText('1234567890')).toBeDefined();
    expect(screen.getByText(/pays this order from your wallet/i)).toBeDefined();
    expect(called(fetchMock, '/api/payments/initialize')).toBe(false);
  });
});
