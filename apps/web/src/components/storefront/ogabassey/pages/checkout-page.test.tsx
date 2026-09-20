import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const { useCheckoutFormTestState } = await import('./checkout/checkout-form-state.test-support');
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
    ),
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
  CdnFormatImage: ({
    alt,
    src,
  }: {
    alt: string;
    src: string;
  }) => <img alt={alt} src={src} />,
}));

import { hasPriceNegotiationEntitlement } from '@/lib/feature-flags';
import { CheckoutPage } from './checkout-page';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { toast } from '@/hooks/use-toast';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { openCredPalCheckout } from '@/lib/credpal';
import { useAuthSafe } from '@/contexts/auth-context';
import {
  usePersistedForm,
  usePersistedState,
} from '@/hooks/use-persisted-state';
import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  getCheckoutIdempotencyKey,
} from './checkout/checkout-idempotency';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './checkout/pending-checkout-order';
import { readCreditDirectPopupMarker } from './checkout/credit-direct-popup-return';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';

function mockCheckoutSubmissionState() {
  vi.mocked(useCart).mockReturnValue({
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
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
      feature_settings: {
        pay_on_delivery_enabled: true,
      },
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue({
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
  } as unknown as ReturnType<typeof usePersistedForm>);
}

async function submitPickupPayOnDeliveryOrder() {
  render(<CheckoutPage />);

  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByText(/pay on delivery/i));
  const placeOrderButton = screen
    .getAllByRole('button', { name: /place order/i })
    .find((button) => !button.hasAttribute('disabled'));
  expect(placeOrderButton).toBeDefined();
  fireEvent.click(placeOrderButton as HTMLButtonElement);
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    addressAutocompleteMock.selectedPlace = null;
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
      cart: [],
      cartTotal: 0,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
    );
    vi.mocked(useAuthSafe).mockReturnValue(
      null as unknown as ReturnType<typeof useAuthSafe>
    );
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedState).mockReturnValue(
      [null, vi.fn(), vi.fn()] as unknown as ReturnType<typeof usePersistedState>
    );
  });

  it('renders without crashing', () => {
    render(<CheckoutPage />);
    // The checkout page should render some form of checkout UI
    // With an empty cart, it redirects or shows empty state
    expect(document.body).toBeTruthy();
  });

  it('wraps the normal checkout state in the OgaBassey checkout scope', async () => {
    mockCheckoutSubmissionState();

    render(<CheckoutPage />);

    const checkoutMarkers = await screen.findAllByText(/secure checkout/i);

    expect(
      checkoutMarkers.some((node) =>
        node.closest('.ogabassey-checkout-page')
      )
    ).toBe(true);
  });

  it('wraps the checkout loading state in the OgaBassey checkout scope', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        gateway: 'credpal',
        orderId: 'ord-1',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(new Promise<Response>(() => undefined));

    try {
      render(<CheckoutPage />);

      const loadingRoot = await screen
        .findByText(/loading order/i)
        .then((node) => node.closest('.ogabassey-checkout-page'));

      expect(loadingRoot).toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('wraps the resume-error state in the OgaBassey checkout scope', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        gateway: 'credpal',
        orderId: 'ord-1',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    try {
      render(<CheckoutPage />);

      const errorRoot = await screen
        .findByText(/something went wrong/i)
        .then((node) => node.closest('.ogabassey-checkout-page'));

      expect(errorRoot).toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('renders the contact step fields when cart has items', async () => {
    const { useCart } = await import('@/hooks/cart');
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);

    render(<CheckoutPage />);

    // Contact step should show checkout form content
    const match =
      screen.queryByPlaceholderText(/email/i) ??
      screen.queryAllByLabelText(/email/i)[0] ??
      screen.queryByText(/contact/i);
    expect(match).toBeTruthy();
  });

  it('renders desktop order-summary thumbnails on the neutral image surface', async () => {
    mockCheckoutSubmissionState();

    render(<CheckoutPage />);

    await screen.findAllByText(/secure checkout/i);

    const orderSummary = screen
      .getByRole('heading', { name: /order summary/i })
      .closest('section,aside,div');

    expect(orderSummary).not.toBeNull();
    expect(
      screen.getByRole('img', { name: 'Test Product' })
    ).toBeInTheDocument();
  });

  it('shows Klump in installment checkout when the merchant enables it', async () => {
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          name: 'Test Product',
          price: 50000,
          quantity: 1,
          image: '',
          slug: 'test-product',
        },
      ],
      cartTotal: 50000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          klump_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    render(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));

    expect(await screen.findByText('Klump')).toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it('hides Klump in installment checkout when the merchant disables it', async () => {
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          name: 'Test Product',
          price: 50000,
          quantity: 1,
          image: '',
          slug: 'test-product',
        },
      ],
      cartTotal: 50000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          klump_enabled: false,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    render(<CheckoutPage />);

    expect(screen.queryByRole('button', { name: /pay in installments/i })).not.toBeInTheDocument();

    expect(screen.queryByText('Klump')).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it('hides Klump when wallet credit is auto-applied', async () => {
    vi.mocked(useAuthSafe).mockReturnValue({
      user: {
        id: 'customer-1',
        email: 'ada@example.com',
        user_metadata: {},
      },
    } as unknown as ReturnType<typeof useAuthSafe>);
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          name: 'Test Product',
          price: 50000,
          quantity: 1,
          image: '',
          slug: 'test-product',
        },
      ],
      cartTotal: 50000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          klump_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/customer/wallet')) {
          return {
            ok: true,
            json: async () => ({ balance: 10000 }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({}),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      fireEvent.click(
        screen.getByRole('button', { name: /pay in installments/i }),
      );

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).startsWith('/api/storefront/customer/wallet'),
          ),
        ).toBe(true);
      });
      await waitFor(() => {
        expect(screen.queryByText('Klump')).not.toBeInTheDocument();
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('includes merchant_slug and tracking token when resuming an order', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credpal',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123'
      );
    });

    fetchMock.mockRestore();
  });

  it('includes a persisted customer email alongside the tracking token when resuming an order', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credpal',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    vi.mocked(usePersistedState).mockReturnValue(
      [
        {
          orderId: 'ord-1',
          merchantId: 'merchant-1',
          customerEmail: 'resume@example.com',
          customerPhone: '+2348012345678',
          checkoutFingerprint: 'fingerprint',
          amountDueToGateway: 1000,
          createdAt: '2026-04-18T00:00:00.000Z',
        },
        vi.fn(),
        vi.fn(),
      ] as unknown as ReturnType<typeof usePersistedState>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123&email=resume%40example.com'
      );
    });

    fetchMock.mockRestore();
  });

  it('falls back to the persisted customer email for legacy resume links without a token', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credpal',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    vi.mocked(usePersistedState).mockReturnValue(
      [
        {
          orderId: 'ord-1',
          merchantId: 'merchant-1',
          customerEmail: 'legacy@example.com',
          customerPhone: '+2348012345678',
          checkoutFingerprint: 'fingerprint',
          amountDueToGateway: 1000,
          createdAt: '2026-04-18T00:00:00.000Z',
        },
        vi.fn(),
        vi.fn(),
      ] as unknown as ReturnType<typeof usePersistedState>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storefront/orders/ord-1?merchant_slug=ogabassey&email=legacy%40example.com'
      );
    });

    fetchMock.mockRestore();
  });

  it('does not fetch a resumed order until a merchant slug is available', async () => {
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credpal',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shipping/locations',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          typeof url === 'string' &&
          url.startsWith('/api/storefront/orders/ord-1')
      )
    ).toBe(false);

    fetchMock.mockRestore();
  });

  it('does not auto-trigger direct checkout for unsupported resume gateways', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'paystack',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/ord-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'ord-1',
              short_id: 'ORD-1',
              subtotal: 1000,
              shipping_cost: 0,
              total: 1000,
              customer_name: 'Ada Buyer',
              customer_email: 'ada@example.com',
              customer_phone: '+2348123456789',
              tracking_token: 'tok-123',
              shipping_address: { address: '', city: '', state: '' },
              items: [],
            }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123'
      );
    });
    expect(openCredPalCheckout).not.toHaveBeenCalled();
    expect(openCreditDirectCheckout).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('persists resumed Credit Direct popup references for webhook reconciliation', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credit_direct',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/ord-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'ord-1',
              short_id: 'ORD-1',
              subtotal: 1000,
              shipping_cost: 0,
              total: 1000,
              customer_name: 'Ada Buyer',
              customer_email: 'ada@example.com',
              customer_phone: '+2348123456789',
              tracking_token: 'tok-123',
              shipping_address: { address: '', city: '', state: '' },
              items: [],
            }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () =>
            typeof init?.body === 'string' ? init.body : '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });

    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    await act(async () => {
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/orders/update-payment-ref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-1',
        paymentRef: 'cd-popup-transaction-1',
        gateway: 'credit_direct',
        tracking_token: 'tok-123',
      }),
    });

    fetchMock.mockRestore();
  });

  it('logs resumed Credit Direct popup reference persistence failures', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credit_direct',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/ord-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'ord-1',
              short_id: 'ORD-1',
              subtotal: 1000,
              shipping_cost: 0,
              total: 1000,
              customer_name: 'Ada Buyer',
              customer_email: 'ada@example.com',
              customer_phone: '+2348123456789',
              tracking_token: 'tok-123',
              shipping_address: { address: '', city: '', state: '' },
              items: [],
            }),
          } as Response;
        }

        if (url === '/api/orders/update-payment-ref') {
          return {
            ok: false,
            status: 500,
            statusText: 'Server Error',
            text: async () => 'write failed',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });

    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    await act(async () => {
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to persist Credit Direct popup reference:',
      expect.stringContaining('ord-1')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to persist Credit Direct popup reference:',
      expect.stringContaining('cd-popup-transaction-1')
    );

    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('hands resumed Credit Direct success to server verification before cleanup', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credit_direct',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    const clearCheckoutSession = vi.fn();
    vi.mocked(usePersistedForm).mockReturnValue({
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
      clear: clearCheckoutSession,
    } as unknown as ReturnType<typeof usePersistedForm>);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/ord-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'ord-1',
              short_id: 'ORD-1',
              subtotal: 1000,
              shipping_cost: 0,
              total: 1000,
              customer_name: 'Ada Buyer',
              customer_email: 'ada@example.com',
              customer_phone: '+2348123456789',
              tracking_token: 'tok-123',
              shipping_address: { address: '', city: '', state: '' },
              items: [],
            }),
          } as Response;
        }
        if (url === '/api/orders/credit-direct/client-completion') {
          return {
            ok: false,
            status: 500,
            statusText: 'Server Error',
            text: async () => 'write failed',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];

      await act(async () => {
        await callArgs?.onSuccess({
          checkoutTransactionId: 'cd-client-success-1',
          sessionId: 'signed-session-1',
        });
      });

      expect(readCreditDirectPopupMarker('ord-1')?.transactionId).toBe(
        'cd-client-success-1'
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orders/credit-direct/client-completion',
        {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: 'ord-1',
            checkoutTransactionId: 'cd-client-success-1',
            customerEmail: 'ada@example.com',
            sessionId: 'signed-session-1',
            tracking_token: 'tok-123',
          }),
        }
      );
      expect(routerPush).toHaveBeenCalledWith(
        '/ogabassey/checkout/bnpl?orderId=ord-1&gateway=credit_direct&merchant_slug=ogabassey&creditDirectCompletion=cd-client-success-1&trackingToken=tok-123&email=ada%40example.com'
      );
      expect(
        routerPush.mock.calls.some(([href]) => String(href).includes('/order-success'))
      ).toBe(false);
      expect(clearCheckoutSession).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it.each([
    {
      gateway: 'credpal',
      openWidget: async () => {
        // The default CredPal mock resolves without firing callbacks, which
        // models a successfully opened widget (its opener rejects on init
        // failure instead of resolving).
        await waitFor(() => {
          expect(openCredPalCheckout).toHaveBeenCalled();
        });
      },
    },
    {
      gateway: 'credit_direct',
      openWidget: async () => {
        // Credit Direct's opener swallows init failures into onError, so
        // only invoking the real popup callback models an opened flow.
        await waitFor(() => {
          expect(openCreditDirectCheckout).toHaveBeenCalled();
        });
        const options = vi.mocked(openCreditDirectCheckout).mock.calls.at(
          -1
        )?.[0];
        await act(async () => {
          await options?.onPopup?.({
            checkoutTransactionId: 'cd-popup-1',
            sessionId: 'signed-session-1',
          });
        });
      },
    },
  ])(
    'emits payment_started once the resumed $gateway flow opens',
    async ({ gateway, openWidget }) => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams({
          orderId: 'ord-1',
          gateway,
          trackingToken: 'tok-123',
        }) as unknown as ReturnType<typeof useSearchParams>
      );
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          if (String(input).startsWith('/api/storefront/orders/ord-1')) {
            return {
              ok: true,
              json: async () => ({
                id: 'ord-1',
                short_id: 'ORD-1',
                subtotal: 1000,
                shipping_cost: 0,
                total: 1000,
                customer_name: 'Ada Buyer',
                customer_email: 'ada@example.com',
                customer_phone: '+2348123456789',
                tracking_token: 'tok-123',
                shipping_address: { address: '', city: '', state: '' },
                items: [],
              }),
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ states: [], locations: [] }),
            text: async () => '',
          } as Response;
        });

      try {
        render(<CheckoutPage />);

        await openWidget();
        await waitFor(() => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'payment_started',
            'ord-1',
            expect.objectContaining({
              payment_method: gateway,
              total: 1000,
            })
          );
        });
        expect(
          mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
            ([event]) => event === 'payment_started'
          )
        ).toHaveLength(1);
      } finally {
        fetchMock.mockRestore();
      }
    }
  );

  it('skips payment_started when resumed Credit Direct initialization fails', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        orderId: 'ord-1',
        gateway: 'credit_direct',
        trackingToken: 'tok-123',
      }) as unknown as ReturnType<typeof useSearchParams>
    );
    // Mirror the opener's catch-and-resolve contract: init failure reaches
    // onError without ever opening a popup.
    vi.mocked(openCreditDirectCheckout).mockImplementationOnce(
      async ({ onError }) => {
        onError?.('Failed to initialize Credit Direct');
      }
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input).startsWith('/api/storefront/orders/ord-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'ord-1',
              short_id: 'ORD-1',
              subtotal: 1000,
              shipping_cost: 0,
              total: 1000,
              customer_name: 'Ada Buyer',
              customer_email: 'ada@example.com',
              customer_phone: '+2348123456789',
              tracking_token: 'tok-123',
              shipping_address: { address: '', city: '', state: '' },
              items: [],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      // Let the error path settle, then assert no start was recorded.
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Payment Failed' })
        );
      });
      expect(
        mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
          ([event]) => event === 'payment_started'
        )
      ).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('hands fresh Credit Direct success to server verification before cleanup', async () => {
    const clearCart = vi.fn();
    const clearCheckoutSession = vi.fn();
    const clearPendingCheckoutOrder = vi.fn();
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
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
      clearCart,
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          credit_direct_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
      clear: clearCheckoutSession,
    } as unknown as ReturnType<typeof usePersistedForm>);
    vi.mocked(usePersistedState).mockReturnValue([
      null,
      vi.fn(),
      clearPendingCheckoutOrder,
    ] as unknown as ReturnType<typeof usePersistedState>);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5750,
              order: {
                id: 'order-cd',
                order_number: 'ORD-CD',
                tracking_token: 'track-cd',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/orders/credit-direct/client-completion') {
          return {
            ok: false,
            status: 500,
            statusText: 'Server Error',
            text: async () => 'write failed',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /pay in installments/i })
      );
      fireEvent.click(
        await screen.findByRole('radio', { name: /credit direct/i })
      );
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      expect(placeOrderButton).toBeDefined();
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];

      await act(async () => {
        await callArgs?.onSuccess({
          checkoutTransactionId: 'cd-client-success-2',
          sessionId: 'signed-session-2',
        });
      });

      expect(readCreditDirectPopupMarker('order-cd')?.transactionId).toBe(
        'cd-client-success-2'
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orders/credit-direct/client-completion',
        {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: 'order-cd',
            checkoutTransactionId: 'cd-client-success-2',
            customerEmail: 'ada@example.com',
            sessionId: 'signed-session-2',
            tracking_token: 'track-cd',
          }),
        }
      );
      expect(routerPush).toHaveBeenCalledWith(
        '/ogabassey/checkout/bnpl?orderId=order-cd&gateway=credit_direct&merchant_slug=ogabassey&creditDirectCompletion=cd-client-success-2&trackingToken=track-cd&email=ada%40example.com'
      );
      expect(
        routerPush.mock.calls.some(([href]) => String(href).includes('/order-success'))
      ).toBe(false);
      expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
      expect(clearCheckoutSession).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  const renderFreshBNPLCheckout = ({
    featureSettings,
    orderId,
  }: {
    featureSettings: Record<string, boolean>;
    orderId: string;
  }) => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: featureSettings,
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    vi.mocked(usePersistedState).mockReturnValue([
      null,
      vi.fn(),
      vi.fn(),
    ] as unknown as ReturnType<typeof usePersistedState>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input) === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5750,
              order: {
                id: orderId,
                order_number: 'ORD-BNPL',
                tracking_token: 'track-bnpl',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });
    return { fetchMock };
  };

  const driveFreshBNPLPlaceOrder = async (radioName: RegExp) => {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /pay in installments/i })
    );
    fireEvent.click(await screen.findByRole('radio', { name: radioName }));
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    fireEvent.click(placeOrderButton as HTMLButtonElement);
  };

  const paymentStartedCalls = () =>
    mockCaptureClientEvent.mock.calls.filter(([event]) => event === 'payment_started');

  it('emits fresh Credit Direct payment_started only after the popup opens', async () => {
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credit_direct_enabled: true },
      orderId: 'order-cd-fresh',
    });

    try {
      await driveFreshBNPLPlaceOrder(/credit direct/i);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      // The opener resolved without a popup: no start yet.
      expect(paymentStartedCalls()).toHaveLength(0);

      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
      await act(async () => {
        await callArgs?.onPopup?.({
          checkoutTransactionId: 'cd-popup-fresh-1',
          sessionId: 'signed-session-fresh-1',
        });
      });

      await waitFor(() => {
        expect(paymentStartedCalls()).toHaveLength(1);
      });
      expect(paymentStartedCalls()[0]?.[1]).toEqual(
        expect.objectContaining({ payment_method: 'credit_direct' })
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('skips payment_started when fresh Credit Direct initialization fails', async () => {
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credit_direct_enabled: true },
      orderId: 'order-cd-fresh-fail',
    });
    vi.mocked(openCreditDirectCheckout).mockImplementationOnce(
      async ({ onError }) => {
        onError?.('Failed to initialize Credit Direct');
      }
    );

    try {
      await driveFreshBNPLPlaceOrder(/credit direct/i);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Credit Direct Failed' })
        );
      });
      expect(paymentStartedCalls()).toHaveLength(0);
      // Unmatched error (no popup ever opened): a failure toast for retry,
      // but no payment_failed attribution — no payment attempt started.
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('tracks payment_failed when Credit Direct errors after the popup opens', async () => {
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credit_direct_enabled: true },
      orderId: 'order-cd-matched-error',
    });

    try {
      await driveFreshBNPLPlaceOrder(/credit direct/i);

      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
      await act(async () => {
        await callArgs?.onPopup?.({
          checkoutTransactionId: 'cd-popup-matched-1',
          sessionId: 'signed-session-matched-1',
        });
      });
      await waitFor(() => {
        expect(paymentStartedCalls()).toHaveLength(1);
      });

      await act(async () => {
        callArgs?.onError?.('declined');
      });

      await waitFor(() => {
        expect(
          mockCaptureClientEvent.mock.calls.some(
            ([event]) => event === 'payment_failed'
          )
        ).toBe(true);
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('emits fresh CredPal payment_started only after the widget loads', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credpal_enabled: true },
      orderId: 'order-credpal-fresh',
    });

    try {
      await driveFreshBNPLPlaceOrder(/credpal/i);

      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      // The widget has not confirmed loading: no start yet.
      expect(paymentStartedCalls()).toHaveLength(0);

      const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
      await act(async () => {
        callArgs?.onLoad?.();
      });

      await waitFor(() => {
        expect(paymentStartedCalls()).toHaveLength(1);
      });
      expect(paymentStartedCalls()[0]?.[1]).toEqual(
        expect.objectContaining({ payment_method: 'credpal' })
      );
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('skips payment_started when fresh CredPal initialization fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credpal_enabled: true },
      orderId: 'order-credpal-fresh-fail',
    });
    vi.mocked(openCredPalCheckout).mockRejectedValueOnce(
      new Error('Failed to load CredPal script')
    );

    try {
      await driveFreshBNPLPlaceOrder(/credpal/i);

      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(toast).toHaveBeenCalled();
      });
      expect(paymentStartedCalls()).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('skips payment_failed when CredPal errors before the widget loads', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credpal_enabled: true },
      orderId: 'order-credpal-preload-error',
    });

    try {
      await driveFreshBNPLPlaceOrder(/credpal/i);

      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
      await act(async () => {
        callArgs?.onError?.({ success: false, message: 'widget setup failed' });
      });

      // Unmatched error (widget never loaded): a failure toast for retry,
      // but no payment_failed attribution — no payment attempt started.
      await waitFor(() => {
        expect(toast).toHaveBeenCalled();
      });
      expect(paymentStartedCalls()).toHaveLength(0);
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('tracks payment_failed when CredPal errors after the widget loads', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const { fetchMock } = renderFreshBNPLCheckout({
      featureSettings: { credpal_enabled: true },
      orderId: 'order-credpal-matched-error',
    });

    try {
      await driveFreshBNPLPlaceOrder(/credpal/i);

      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
      await act(async () => {
        callArgs?.onLoad?.();
      });
      await waitFor(() => {
        expect(paymentStartedCalls()).toHaveLength(1);
      });

      await act(async () => {
        callArgs?.onError?.({ success: false, message: 'declined' });
      });

      await waitFor(() => {
        expect(
          mockCaptureClientEvent.mock.calls.some(
            ([event]) => event === 'payment_failed'
          )
        ).toBe(true);
      });
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('records payment_completed before redirecting a paid wallet-funded transfer', async () => {
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: {
          paystack_enabled: true,
          wallet_paystack_dva_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => ({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      }) as Response);

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const bankTransferRadio = (
        await screen.findAllByRole('radio', { name: /bank transfer/i })
      ).find((radio) => radio.getAttribute('value') === 'bank_transfer');
      expect(bankTransferRadio).toBeDefined();
      fireEvent.click(bankTransferRadio as HTMLInputElement);

      // The polling hook reports a server-confirmed completed intent.
      await act(async () => {
        walletFundedTransferMock.onOrderPaid?.({
          checkoutFingerprint: 'fingerprint-wf-1',
          currency: 'NGN',
          orderId: 'order-wf-1',
          orderNumber: 'ORD-WF-1',
          total: 5750,
          trackingToken: 'track-wf-1',
        });
      });

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-wf-1',
        expect.objectContaining({
          order_number: 'ORD-WF-1',
          payment_method: 'bank_transfer',
          payment_status: 'paid',
          total: 5750,
        })
      );
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining(
          '/order-success?orderId=order-wf-1&wallet=true&trackingToken=track-wf-1'
        )
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('traverses the Juicyway funnel from selector init to confirmed completion', async () => {
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: { juicyway_enabled: true },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5750,
              order: {
                id: 'order-juicy-1',
                order_number: 'ORD-JUICY-1',
                tracking_token: 'track-juicy-1',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              reference: 'juicy-ref-1',
              session_id: 'sess-1',
              crypto_payment: {
                // Must satisfy the TRX base58 address check in the
                // initialization response schema or init rejects.
                address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
                chain: 'TRX',
                currency: 'USDT',
                amount: 5750,
                crypto_amount: '1.5',
                confirmation_time: '10 minutes',
                payment_id: 'pay-1',
              },
            }),
            text: async () => '',
          } as Response;
        }
        if (url.startsWith('/api/payments/status')) {
          return {
            ok: true,
            json: async () => ({ is_confirmed: true }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const juicywayRadio = (
        await screen.findAllByRole('radio', { name: /juicyway/i })
      ).find((radio) => radio.getAttribute('value') === 'juicyway');
      expect(juicywayRadio).toBeDefined();
      fireEvent.click(juicywayRadio as HTMLInputElement);
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      // The selector opens without any funnel event: initialization has not
      // run yet. The Juicyway start travels through the Once helper (not the
      // raw client event), so filter that mock here.
      const juicywayPaymentStartedCalls = () =>
        mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
          ([event]) => event === 'payment_started'
        );
      const continueButton = await screen.findByRole('button', {
        name: /continue with USDT on TRX/i,
      });
      expect(juicywayPaymentStartedCalls()).toHaveLength(0);

      // Successful address initialization records the start.
      fireEvent.click(continueButton);
      await waitFor(() => {
        expect(juicywayPaymentStartedCalls()).toHaveLength(1);
      });
      expect(juicywayPaymentStartedCalls()[0]?.[1]).toBe('order-juicy-1');
      expect(juicywayPaymentStartedCalls()[0]?.[2]).toEqual(
        expect.objectContaining({
          payment_method: 'juicyway',
          total: 5750,
        })
      );

      // Server-confirmed verification records the completion, then routes.
      fireEvent.click(
        await screen.findByRole('button', { name: /i've sent the payment/i })
      );
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_completed',
          'order-juicy-1',
          expect.objectContaining({
            payment_method: 'juicyway',
            payment_status: 'paid',
            reference: 'juicy-ref-1',
            total: 5750,
          })
        );
      });
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining(
          '/order-success?type=crypto&orderId=order-juicy-1&reference=juicy-ref-1'
        )
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('records payment_failed when the initial Juicyway check reports failed', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: { juicyway_enabled: true },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5750,
              order: {
                id: 'order-juicy-1',
                order_number: 'ORD-JUICY-1',
                tracking_token: 'track-juicy-1',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              reference: 'juicy-ref-1',
              session_id: 'sess-1',
              crypto_payment: {
                address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
                chain: 'TRX',
                currency: 'USDT',
                amount: 5750,
                crypto_amount: '1.5',
                confirmation_time: '10 minutes',
                payment_id: 'pay-1',
              },
            }),
            text: async () => '',
          } as Response;
        }
        if (url.startsWith('/api/payments/status')) {
          return {
            ok: true,
            json: async () => ({ is_failed: true }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const juicywayRadio = (
        await screen.findAllByRole('radio', { name: /juicyway/i })
      ).find((radio) => radio.getAttribute('value') === 'juicyway');
      fireEvent.click(juicywayRadio as HTMLInputElement);
      fireEvent.click(
        screen
          .getAllByRole('button', { name: /place order/i })
          .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /continue with USDT on TRX/i })
      );
      await waitFor(() => {
        expect(
          mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
            ([event]) => event === 'payment_started'
          )
        ).toHaveLength(1);
      });

      // Terminal initial check closes the recorded start with a failure.
      fireEvent.click(
        await screen.findByRole('button', { name: /i've sent the payment/i })
      );
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_failed',
          'order-juicy-1',
          expect.objectContaining({
            payment_method: 'juicyway',
            reason: 'juicyway_error',
            reference: 'juicy-ref-1',
          })
        );
      });
      expect(
        await screen.findByText('Payment verification failed. Please contact support.')
      ).toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('records payment_failed when a polled Juicyway check reports failed', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: { juicyway_enabled: true },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    let statusCalls = 0;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5750,
              order: {
                id: 'order-juicy-1',
                order_number: 'ORD-JUICY-1',
                tracking_token: 'track-juicy-1',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              reference: 'juicy-ref-1',
              session_id: 'sess-1',
              crypto_payment: {
                address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
                chain: 'TRX',
                currency: 'USDT',
                amount: 5750,
                crypto_amount: '1.5',
                confirmation_time: '10 minutes',
                payment_id: 'pay-1',
              },
            }),
            text: async () => '',
          } as Response;
        }
        if (url.startsWith('/api/payments/status')) {
          statusCalls += 1;
          // Initial check pending, first poll reports failed.
          const failed = statusCalls > 1;
          return {
            ok: true,
            json: async () => (failed ? { is_failed: true } : {}),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });
    // Capture the 10s poll callback instead of waiting out real timers.
    const pollCallbacks: Array<() => void> = [];
    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((((callback: () => void) => {
        pollCallbacks.push(callback);
        return 123 as unknown as NodeJS.Timeout;
      }) as unknown) as typeof setInterval);

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const juicywayRadio = (
        await screen.findAllByRole('radio', { name: /juicyway/i })
      ).find((radio) => radio.getAttribute('value') === 'juicyway');
      fireEvent.click(juicywayRadio as HTMLInputElement);
      fireEvent.click(
        screen
          .getAllByRole('button', { name: /place order/i })
          .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /continue with USDT on TRX/i })
      );
      await waitFor(() => {
        expect(
          mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
            ([event]) => event === 'payment_started'
          )
        ).toHaveLength(1);
      });

      fireEvent.click(
        await screen.findByRole('button', { name: /i've sent the payment/i })
      );
      // Initial check pending: polling starts, no failure yet.
      await waitFor(() => {
        expect(pollCallbacks.length).toBeGreaterThan(0);
      });
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );

      // First poll reports failed: the start closes with a failure.
      await act(async () => {
        await pollCallbacks[pollCallbacks.length - 1]?.();
      });
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_failed',
          'order-juicy-1',
          expect.objectContaining({
            payment_method: 'juicyway',
            reason: 'juicyway_error',
          })
        );
      });
      expect(
        await screen.findByText('Payment verification failed. Please contact support.')
      ).toBeInTheDocument();
    } finally {
      intervalSpy.mockRestore();
      fetchMock.mockRestore();
    }
  });

  it('records the full order total for crypto completion after wallet credits', async () => {
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: { juicyway_enabled: true },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              // Wallet credits cover all but 750: provider initialization
              // runs on the residual while revenue stays the full total.
              amountDueToGateway: 750,
              order: {
                id: 'order-juicy-1',
                order_number: 'ORD-JUICY-1',
                tracking_token: 'track-juicy-1',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              reference: 'juicy-ref-1',
              session_id: 'sess-1',
              crypto_payment: {
                address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
                chain: 'TRX',
                currency: 'USDT',
                amount: 750,
                crypto_amount: '1.5',
                confirmation_time: '10 minutes',
                payment_id: 'pay-1',
              },
            }),
            text: async () => '',
          } as Response;
        }
        if (url.startsWith('/api/payments/status')) {
          return {
            ok: true,
            json: async () => ({ is_confirmed: true }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const juicywayRadio = (
        await screen.findAllByRole('radio', { name: /juicyway/i })
      ).find((radio) => radio.getAttribute('value') === 'juicyway');
      expect(juicywayRadio).toBeDefined();
      fireEvent.click(juicywayRadio as HTMLInputElement);
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      const continueButton = await screen.findByRole('button', {
        name: /continue with USDT on TRX/i,
      });
      fireEvent.click(continueButton);
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/payments/initialize',
          expect.anything()
        );
      });

      // Server-confirmed verification records the FULL order total, not
      // the 750 residual the provider initialized.
      fireEvent.click(
        await screen.findByRole('button', { name: /i've sent the payment/i })
      );
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_completed',
          'order-juicy-1',
          expect.objectContaining({
            payment_method: 'juicyway',
            payment_status: 'paid',
            reference: 'juicy-ref-1',
            total: 5750,
          })
        );
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('blocks order creation when door delivery has no selected quote', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          pay_on_delivery_enabled: true,
          paystack_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: 'Obafemi Awolowo Way',
        newAddressState: 'Lagos',
        newAddressCity: 'Lagos',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    fireEvent.click(screen.getByText(/pay on delivery/i));
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(placeOrderButton).toBeDefined();
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Select Delivery Option',
        })
      );
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
    ).toBe(false);

    fetchMock.mockRestore();
  });

  it('threads a selected merchant rate through the order POST (null provider path)', async () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'NG',
        feature_settings: {
          pay_on_delivery_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const merchantRateQuote = {
      carrierName: 'Standard Delivery',
      currency: 'NGN',
      displayName: 'Standard Delivery',
      estimatedDays: 0,
      id: 'mrate_9f1b2c3d-0000-4000-8000-000000000009',
      insuranceIncluded: false,
      pickupIncluded: false,
      price: 1500,
      provider: 'MERCHANT',
      serviceTier: 'standard',
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [merchantRateQuote] } }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 6500,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                currency: 'NGN',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // The door-delivery effect fetches quotes and auto-selects the merchant rate.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    fireEvent.click(await screen.findByText(/pay on delivery/i));
    await waitFor(() => {
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      expect(placeOrderButton).toBeDefined();
      fireEvent.click(placeOrderButton as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
      ).toBe(true);
    });

    const orderBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
          ?.body
      )
    );

    // Merchant rate carries the bare uuid and takes the null-provider RPC path.
    expect(orderBody.shipping_rate_id).toBe(
      '9f1b2c3d-0000-4000-8000-000000000009'
    );
    expect(orderBody.shipping_provider).toBeNull();
    expect(orderBody.selected_quote_id).toBeNull();
    expect(orderBody.shipping_fee).toBe(1500);

    fetchMock.mockRestore();
    scrollSpy.mockRestore();
  });

  it.each(['delivery', 'korapay'])('persists the merchant country for a non-NG order paid with %s and a Nigerian phone', async (method) => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'IN',
        payout_currency: method === 'korapay' ? 'NGN' : 'INR',
        feature_settings: {
          pay_on_delivery_enabled: true,
          korapay_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348034096325',
        newAddressStreet: '12 Marine Drive',
        newAddressState: 'Maharashtra',
        newAddressCity: 'Mumbai',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const merchantRateQuote = {
      carrierName: 'Standard Delivery',
      currency: method === 'korapay' ? 'NGN' : 'INR',
      displayName: 'Standard Delivery',
      estimatedDays: 0,
      id: 'mrate_1a2b3c4d-0000-4000-8000-00000000000a',
      insuranceIncluded: false,
      pickupIncluded: false,
      price: 1500,
      provider: 'MERCHANT',
      serviceTier: 'standard',
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [merchantRateQuote] } }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return Response.json({ success: true, authorization_url: 'https://checkout.paystack.com/test', reference: 'reference' });
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 6500,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                currency: method === 'korapay' ? 'NGN' : 'INR',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Maharashtra'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    fireEvent.click(await screen.findByText(method === 'delivery' ? /pay on delivery/i : /^Korapay$/));
    await waitFor(() => {
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      expect(placeOrderButton).toBeDefined();
      fireEvent.click(placeOrderButton as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
      ).toBe(true);
    });

    if (method === 'korapay') {
      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/payments/initialize')).toBe(true));
      const initialization = fetchMock.mock.calls.find(([url]) => String(url) === '/api/payments/initialize');
      const body = JSON.parse(String(initialization?.[1]?.body));
      expect(body.billing_address.country).toBe('IN');
      expect(body.billing_address.zip_code).toBeUndefined();
      expect(body.customer_phone).toBe('+2348034096325');
    }

    const orderBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
          ?.body
      )
    );

    // The order the merchant is quoted+charged for must be persisted (and later
    // invoiced) with the merchant country, not the legacy NG fallback.
    expect(orderBody.shipping_address).toMatchObject({
      state: 'Maharashtra',
      city: 'Mumbai',
      countryCode: 'IN',
      country: 'India',
    });

    fetchMock.mockRestore();
    scrollSpy.mockRestore();
  });

  it('drops a stale merchant rate id when switching from a merchant rate to store pickup', async () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'NG',
        feature_settings: {
          pay_on_delivery_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    // A door merchant rate; selecting it stamps `selectedQuoteId` with the
    // synthetic `mrate_<uuid>` id.
    const merchantRateQuote = {
      carrierName: 'Standard Delivery',
      currency: 'NGN',
      displayName: 'Standard Delivery',
      estimatedDays: 0,
      id: 'mrate_9f1b2c3d-0000-4000-8000-000000000009',
      insuranceIncluded: false,
      pickupIncluded: false,
      price: 1500,
      provider: 'MERCHANT',
      serviceTier: 'standard',
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [merchantRateQuote] } }),
            text: async () => '',
          } as Response;
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                currency: 'NGN',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // Door delivery fetches quotes and auto-selects the merchant rate.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    // Switch to legacy in-store pickup. The method switch preserves the merchant
    // rate id in `selectedQuoteId`, but a pickup checkout must submit a free,
    // provider-less order — the stale rate id must NOT surface as
    // `shipping_rate_id` (which would 400 with SHIPPING_FEE_MISMATCH or route
    // the wrong fulfillment provider).
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    fireEvent.click(await screen.findByText(/pay on delivery/i));
    await waitFor(() => {
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      expect(placeOrderButton).toBeDefined();
      fireEvent.click(placeOrderButton as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
      ).toBe(true);
    });

    const orderBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
          ?.body
      )
    );

    // A normal store-pickup order: no rate id, no provider, no quote, no fee.
    expect(orderBody.shipping_rate_id).toBeUndefined();
    expect(orderBody.selected_quote_id).toBeNull();
    expect(orderBody.shipping_provider).toBeNull();
    expect(orderBody.shipping_fee).toBe(0);

    fetchMock.mockRestore();
    scrollSpy.mockRestore();
  });

  it('renders every merchant pickup location as an individually selectable option', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    // Two merchant pickup rates configured in the same zone.
    const pickupQuotes = [
      {
        carrierName: 'Ikeja Store',
        currency: 'NGN',
        displayName: 'Ikeja Store Pickup',
        estimatedDays: 0,
        id: 'mrate_11111111-0000-4000-8000-000000000001',
        insuranceIncluded: false,
        isStationPickup: true,
        pickupIncluded: false,
        price: 0,
        provider: 'MERCHANT',
        serviceTier: 'pickup',
        stationName: 'Ikeja Store',
        stationAddress: '12 Allen Avenue, Ikeja, Lagos',
        stationInstructions: 'Ring the bell twice and ask for Ada',
      },
      {
        carrierName: 'Lekki Store',
        currency: 'NGN',
        displayName: 'Lekki Store Pickup',
        estimatedDays: 0,
        id: 'mrate_22222222-0000-4000-8000-000000000002',
        insuranceIncluded: false,
        isStationPickup: true,
        pickupIncluded: false,
        price: 1500,
        provider: 'MERCHANT',
        serviceTier: 'pickup',
        stationName: 'Lekki Store',
        stationAddress: '5 Admiralty Way, Lekki, Lagos',
      },
    ];

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: pickupQuotes } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    // Switch to the merchant pickup tab.
    fireEvent.click(await screen.findByText('Store Pickup'));

    // Both pickup locations are selectable — the second must not silently vanish.
    const ikejaRadio = await screen.findByRole('radio', {
      name: /Ikeja Store/i,
    });
    const lekkiRadio = screen.getByRole('radio', { name: /Lekki Store/i });
    expect(ikejaRadio).toBeChecked();
    expect(lekkiRadio).not.toBeChecked();

    // Merchant pickup collection instructions surface in the pickup detail.
    expect(
      screen.getByText('Ring the bell twice and ask for Ada')
    ).toBeInTheDocument();

    fireEvent.click(lekkiRadio);

    expect(lekkiRadio).toBeChecked();
    expect(ikejaRadio).not.toBeChecked();

    fetchMock.mockRestore();
  });

  it('hides the free legacy pickup tab when a merchant pickup exists behind a GIGL station quote', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    // A GIGL station quote is returned FIRST, followed by the merchant's own
    // pickup rate. Both set `isStationPickup: true`, so `getStationPickupQuote`
    // (the first) is the GIGL station and `isMerchantQuote(firstQuote)` is false.
    // The legacy free in-store pickup tab must still be suppressed because ANY
    // station-pickup quote is a merchant rate.
    const quotes = [
      {
        carrierName: 'GIG Logistics',
        currency: 'NGN',
        displayName: 'GIG Logistics - Pickup at Ikeja Service Centre',
        estimatedDays: 3,
        id: 'station-1',
        insuranceIncluded: true,
        isStationPickup: true,
        pickupIncluded: true,
        price: 4200,
        provider: 'GIGL',
        serviceTier: 'station',
        stationName: 'Ikeja Service Centre',
        stationAddress: '10 Allen Avenue, Ikeja, Lagos',
      },
      {
        carrierName: 'Baci Flagship',
        currency: 'NGN',
        displayName: 'Baci Flagship Collection',
        estimatedDays: 0,
        id: 'mrate_33333333-0000-4000-8000-000000000003',
        insuranceIncluded: false,
        isStationPickup: true,
        pickupIncluded: false,
        price: 1500,
        provider: 'MERCHANT',
        serviceTier: 'pickup',
        stationName: 'Baci Flagship',
        stationAddress: '7 Adeola Odeku, Victoria Island, Lagos',
      },
    ];

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: quotes } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).startsWith('/api/shipping/quotes')
          )
        ).toBe(true);
      });

      // The provider-aware pickup_station tab (GIGL copy, since the first
      // station quote is a GIGL station) reveals for the merchant pickup...
      const pickupStationTab = await screen.findByText('Pickup Stations (GIGL)');

      // ...but the hardcoded ZERO-FEE legacy in-store pickup tab is suppressed.
      // Its "Collect at store" subtitle uniquely identifies that tab.
      expect(screen.queryByText('Collect at store')).not.toBeInTheDocument();

      // The merchant pickup remains individually selectable inside the tab.
      fireEvent.click(pickupStationTab);

      const merchantPickupRadio = await screen.findByRole('radio', {
        name: /baci flagship collection/i,
      });
      fireEvent.click(merchantPickupRadio);
      expect(merchantPickupRadio).toBeChecked();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('switches a shopper off legacy pickup onto the merchant pickup rate when the quote arrives', async () => {
    // R16-2: the shopper picks legacy "Store Pickup" WHILE the door quote is
    // still loading (no merchant pickup quote yet, so the legacy tab shows).
    // When the in-flight quote resolves with a merchant PICKUP rate, the legacy
    // tab is hidden — but without the render-time reset the selection would
    // linger on fee-free `pickup`. The reset must move it onto the merchant
    // pickup station (pickup_station + the merchant pickup selected) so the
    // order carries the rate id + fee.
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const merchantPickupQuote = {
      carrierName: 'Ikeja Store',
      currency: 'NGN',
      displayName: 'Ikeja Store Pickup',
      estimatedDays: 0,
      id: 'mrate_44444444-0000-4000-8000-000000000004',
      insuranceIncluded: false,
      isStationPickup: true,
      pickupIncluded: false,
      price: 1500,
      provider: 'MERCHANT',
      serviceTier: 'pickup',
      stationName: 'Ikeja Store',
      stationAddress: '12 Allen Avenue, Ikeja, Lagos',
    };

    // Hold the quote response open so the shopper can select legacy pickup
    // BEFORE the merchant pickup rate arrives.
    let resolveQuotes: (value: Response) => void = () => undefined;
    const quotesPromise = new Promise<Response>((resolve) => {
      resolveQuotes = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return quotesPromise;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      // The door-delivery effect fires the (still-pending) quote request.
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).startsWith('/api/shipping/quotes')
          )
        ).toBe(true);
      });

      // Legacy pickup is still offered (no merchant pickup quote yet) — select
      // it while the quote is loading.
      fireEvent.click(
        await screen.findByRole('button', { name: /store pickup/i })
      );

      // The in-flight quote resolves with the merchant pickup rate.
      await act(async () => {
        resolveQuotes({
          ok: true,
          json: async () => ({ quotes: { all: [merchantPickupQuote] } }),
          text: async () => '',
        } as Response);
        await quotesPromise;
      });

      // The reset moved the shopper onto the merchant pickup station and
      // selected the merchant pickup quote (so the order would carry the rate
      // id + fee, not a fee-free legacy pickup).
      const merchantPickupRadio = await screen.findByRole('radio', {
        name: /ikeja store/i,
      });
      expect(merchantPickupRadio).toBeChecked();
      // The legacy fee-free pickup affordance is gone.
      expect(screen.queryByText('Main Office Pickup')).not.toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('refetches door quotes after merchant context resolves', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: 'Obafemi Awolowo Way',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: null,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({
              quotes: {
                all: [
                  {
                    carrierName: 'GIG Logistics',
                    currency: 'NGN',
                    displayName: 'Door Delivery',
                    estimatedDays: 2,
                    id: 'quote-1',
                    insuranceIncluded: true,
                    pickupIncluded: true,
                    price: 2500,
                    provider: 'GIGL',
                    serviceTier: 'standard',
                  },
                ],
              },
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    const { rerender } = render(<CheckoutPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shipping/locations',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/shipping/quotes')
      )
    ).toBe(false);

    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);

    rerender(<CheckoutPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });
    const quoteCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith('/api/shipping/quotes')
    );
    expect(JSON.parse(String(quoteCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        merchantId: 'merchant-1',
        // Advisory subtotal so free-over / price-tier merchant rates quote right.
        cart_subtotal: expect.any(Number),
        // Opt-in capability flag: the OgaBassey checkout threads
        // `shipping_rate_id` end to end, so it asks the shared quotes endpoint
        // to include merchant-configured rates.
        supports_merchant_rates: true,
        receiver: expect.objectContaining({
          // Destination country derived from the merchant's country (NG).
          country: 'Nigeria',
          countryCode: 'NG',
        }),
      })
    );

    fetchMock.mockRestore();
  });

  it('refetches quotes with new coordinates when the selected place stays in the same city', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: 'Old address, Ikeja',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);
    addressAutocompleteMock.selectedPlace = {
      city: 'Ikeja',
      formattedAddress: 'New address, Ikeja',
      location: { latitude: 6.6018, longitude: 3.3515 },
      state: 'Lagos',
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input).startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes'),
        ),
      ).toBe(true);
    });
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId('select-address-place'));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes'),
        ),
      ).toBe(true);
    });
    const quoteCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith('/api/shipping/quotes'),
    );
    expect(JSON.parse(String(quoteCall?.[1]?.body)).receiver).toEqual(
      expect.objectContaining({ latitude: 6.6018, longitude: 3.3515 }),
    );

    fetchMock.mockRestore();
  });

  it('renders every GIGL pickup station quote and lets the shopper choose one', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: 'GRA Phase 2',
        newAddressState: 'Rivers',
        newAddressCity: 'Port Harcourt',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const stationQuote = (
      id: string,
      stationName: string,
      stationAddress: string,
    ) => ({
      carrierName: 'GIG Logistics',
      currency: 'NGN',
      displayName: `GIG Logistics - Pickup at ${stationName}`,
      estimatedDays: 3,
      id,
      insuranceIncluded: true,
      isStationPickup: true,
      pickupIncluded: true,
      price: 4200,
      provider: 'GIGL',
      serviceTier: 'station',
      stationAddress,
      stationName,
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (String(input).startsWith('/api/shipping/quotes')) {
          const { deliveryPreference } = JSON.parse(String(init?.body));
          return {
            ok: true,
            json: async () => ({
              quotes: {
                all:
                  deliveryPreference === 'pickup_station'
                    ? [
                        stationQuote(
                          'station-1',
                          'Aba Road Service Centre',
                          '10 Aba Road, Port Harcourt',
                        ),
                        stationQuote(
                          'station-2',
                          'Trans Amadi Service Centre',
                          '5 Trans Amadi Road, Port Harcourt',
                        ),
                      ]
                    : [
                        {
                          carrierName: 'GIG Logistics',
                          currency: 'NGN',
                          displayName: 'Door Delivery',
                          estimatedDays: 2,
                          id: 'door-1',
                          insuranceIncluded: true,
                          pickupIncluded: true,
                          price: 6200,
                          provider: 'GIGL',
                          serviceTier: 'standard',
                        },
                      ],
              },
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Rivers'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);

      // Door quotes resolve first for the default delivery method.
      await screen.findByText('Door Delivery');

      fireEvent.click(screen.getByRole('button', { name: /pickup station/i }));

      // Switching methods refetches quotes with the pickup_station preference.
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            ([url, init]) =>
              String(url).startsWith('/api/shipping/quotes') &&
              JSON.parse(String(init?.body)).deliveryPreference ===
                'pickup_station',
          ),
        ).toBe(true);
      });

      // Every returned GIGL service centre renders as a selectable option,
      // with the first one auto-selected after the pickup_station refetch.
      const firstStation = await screen.findByRole('radio', {
        name: /aba road service centre/i,
      });
      const secondStation = screen.getByRole('radio', {
        name: /trans amadi service centre/i,
      });
      await waitFor(() => expect(firstStation).toBeChecked());
      expect(secondStation).not.toBeChecked();

      fireEvent.click(secondStation);

      expect(secondStation).toBeChecked();
      expect(firstStation).not.toBeChecked();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('quotes merchant rates against the catalog subtotal, not the negotiated total', async () => {
    vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(true);
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          cartItemId: 'ci-1',
          name: 'Test Product',
          price: 5000,
          negotiatedPrice: 4000,
          negotiationStatus: 'accepted' as const,
          quantity: 2,
          image: '',
          slug: 'test-product',
          hasAssurance: true,
          assuranceRate: 0.05,
        },
      ],
      cartTotal: 8400,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    const quoteCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith('/api/shipping/quotes')
    );
    const body = JSON.parse(String(quoteCall?.[1]?.body));

    // Catalog goods (5000 x 2 = 10000) + negotiated-basis assurance
    // (4000 x 2 x 0.05 = 400) = 10400 — NOT the negotiated total (8400).
    expect(body.cart_subtotal).toBe(10400);

    fetchMock.mockRestore();
  });

  it('re-quotes when toggling assurance shifts the catalog subtotal without changing the item fingerprint', async () => {
    const baseItem = {
      id: 'item-1',
      name: 'Test Product',
      price: 5000,
      quantity: 2,
      image: '',
      slug: 'test-product',
    };
    vi.mocked(useCart).mockReturnValue({
      cart: [baseItem],
      cartTotal: 10000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    const quoteSubtotals = () =>
      fetchMock.mock.calls
        .filter(([url]) => String(url).startsWith('/api/shipping/quotes'))
        .map(([, init]) => JSON.parse(String(init?.body)).cart_subtotal);

    const { rerender } = render(<CheckoutPage />);

    // First quote uses the assurance-off catalog subtotal (5000 x 2 = 10000).
    await waitFor(() => {
      expect(quoteSubtotals()).toContain(10000);
    });

    // Toggle assurance ON. Same id/quantity/price, so `quoteItemsFingerprint`
    // (id:quantity:price) is byte-for-byte identical, but the catalog subtotal
    // now includes the assurance fee (5000 x 2 x 0.05 = 500) -> 10500.
    vi.mocked(useCart).mockReturnValue({
      cart: [{ ...baseItem, hasAssurance: true, assuranceRate: 0.05 }],
      cartTotal: 10500,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);

    rerender(<CheckoutPage />);

    // The subtotal-basis change must re-trigger the quote fetch even though the
    // item fingerprint never changed (regression: stale fee -> order-time
    // SHIPPING_FEE_MISMATCH for merchant free-over / price-tier rates).
    await waitFor(() => {
      expect(quoteSubtotals()).toContain(10500);
    });

    fetchMock.mockRestore();
  });

  it('sends a stable idempotency key when creating an order', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const randomUuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          name: 'Test Product',
          price: 5000,
          quantity: 1,
          image: '',
          slug: 'test-product',
          variantId: 'variant-blue',
          variantAttributes: { color: ' Blue ', storage: '128GB' },
        },
      ],
      cartTotal: 5000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          pay_on_delivery_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    await submitPickupPayOnDeliveryOrder();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
      ).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
          }),
        })
      );
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).toBeNull();
    });

    const savedAttempt = storageSpy.mock.calls.find(([key]) => key === 'storefront-checkout-pending-order');
    expect(savedAttempt).toBeDefined();
    const snapshot = JSON.parse(String(savedAttempt?.[1]));
    expect(JSON.parse(snapshot.checkoutFingerprint).items[0]).toMatchObject({
      variantId: 'variant-blue', variantAttributes: { color: 'blue', storage: '128gb' },
    });
    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'order_created',
      'order-123',
      expect.objectContaining({
        channel: 'web',
        order_id: 'order-123',
        order_number: 'ORD-123',
        source: 'web_checkout',
      })
    );
    storageSpy.mockRestore();
    fetchMock.mockRestore();
    randomUuidSpy.mockRestore();
    scrollSpy.mockRestore();
    window.localStorage.clear();
  });

  it('attributes order_created to the server-finalized method when coverage changes it', async () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const randomUuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    window.localStorage.clear();
    mockCheckoutSubmissionState();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 0,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                // Wallet fully covered an order placed under another
                // selection: creation must follow the finalized method.
                payment_method: 'wallet',
                payment_status: 'paid',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    await submitPickupPayOnDeliveryOrder();

    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'order_created',
        'order-123',
        expect.objectContaining({
          payment_method: 'wallet',
          payment_intent: 'pay_now',
          payment_status: 'paid',
        })
      );
    });
    fetchMock.mockRestore();
    randomUuidSpy.mockRestore();
    scrollSpy.mockRestore();
    window.localStorage.clear();
  });

  it('records the full order total for CredPal completion after wallet credits', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: { credpal_enabled: true },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    let capturedOnSuccess:
      | ((data: {
          status: 'success' | 'pending';
          order_no: string;
        }) => Promise<void>)
      | undefined;
    vi.mocked(openCredPalCheckout).mockImplementation(async (config) => {
      capturedOnSuccess = config.onSuccess as typeof capturedOnSuccess;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              // Wallet credits cover all but 750: the CredPal widget
              // opens on the residual while revenue stays the full total.
              amountDueToGateway: 750,
              order: {
                id: 'order-cred-1',
                order_number: 'ORD-CRED-1',
                tracking_token: 'track-cred-1',
                total: 5750,
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      // CredPal lives under the installments tab.
      fireEvent.click(
        await screen.findByRole('button', { name: /pay in installments/i })
      );
      const credpalRadio = (
        await screen.findAllByRole('radio', { name: /credpal/i })
      ).find((radio) => radio.getAttribute('value') === 'credpal');
      expect(credpalRadio).toBeDefined();
      fireEvent.click(credpalRadio as HTMLInputElement);
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      await capturedOnSuccess?.({
        status: 'success',
        order_no: 'CP-123',
      });

      // Server-confirmed completion records the FULL order total, not
      // the 750 residual the widget opened with.
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_completed',
          'order-cred-1',
          expect.objectContaining({
            payment_method: 'credpal',
            payment_status: 'paid',
            reference: 'CP-123',
            total: 5750,
          })
        );
      });
    } finally {
      fetchMock.mockRestore();
      window.localStorage.clear();
      vi.unstubAllEnvs();
    }
  });

  it.each(['paystack', 'korapay'])(
    'attributes order_created to the selected %s gateway despite card normalization',
    async (gateway) => {
      window.localStorage.clear();
      vi.mocked(useCart).mockReturnValue({
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
      } as unknown as ReturnType<typeof useCart>);
      vi.mocked(useMerchantSafe).mockReturnValue({
        merchant: {
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Test Store',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
          country: 'NG',
          paystack_subaccount_code: 'ACCT_test',
          feature_settings: {
            paystack_enabled: true,
            korapay_enabled: true,
          },
        },
        basePath: '/ogabassey',
      } as unknown as ReturnType<typeof useMerchantSafe>);
      vi.mocked(usePersistedForm).mockReturnValue({
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
      } as unknown as ReturnType<typeof usePersistedForm>);

      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url === '/api/payments/initialize') {
            return {
              ok: true,
              json: async () => ({
                success: true,
                authorization_url: 'https://checkout.example/test',
                reference: 'reference',
              }),
              text: async () => '',
            } as Response;
          }
          if (url === '/api/orders') {
            return {
              ok: true,
              json: async () => ({
                amountDueToGateway: 5750,
                order: {
                  id: 'order-123',
                  order_number: 'ORD-123',
                  tracking_token: 'track-123',
                  // The server persists ordinary card checkouts as
                  // `card`: creation must still use the selected gateway
                  // so it shares a funnel with start/completion.
                  payment_method: 'card',
                  payment_status: 'unpaid',
                },
                wallet: null,
              }),
              text: async () => '',
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ states: ['Lagos'], locations: [] }),
            text: async () => '',
          } as Response;
        });

      try {
        render(<CheckoutPage />);
        fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
        fireEvent.click(
          screen.getByRole('button', { name: /continue to payment/i })
        );
        const gatewayRadio = (
          await screen.findAllByRole('radio', { name: new RegExp(gateway, 'i') })
        ).find((radio) => radio.getAttribute('value') === gateway);
        expect(gatewayRadio).toBeDefined();
        fireEvent.click(gatewayRadio as HTMLInputElement);
        const placeOrderButton = screen
          .getAllByRole('button', { name: /place order/i })
          .find((button) => !button.hasAttribute('disabled'));
        fireEvent.click(placeOrderButton as HTMLButtonElement);

        await waitFor(() => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'order_created',
            'order-123',
            expect.objectContaining({
              payment_method: gateway,
              payment_intent: 'pay_now',
            })
          );
        });
      } finally {
        fetchMock.mockRestore();
        window.localStorage.clear();
      }
    }
  );

  it('does not record completion for a zero-due order the server left unpaid', async () => {
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          paystack_enabled: true,
          korapay_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              // A 100% discount zeroes the gateway amount, but the orders
              // API leaves payment_status unpaid: no provider or server
              // payment confirmation occurred.
              amountDueToGateway: 0,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                payment_method: 'paystack',
                payment_status: 'unpaid',
                total: 0,
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      const gatewayRadio = (
        await screen.findAllByRole('radio', { name: /paystack/i })
      ).find((radio) => radio.getAttribute('value') === 'paystack');
      expect(gatewayRadio).toBeDefined();
      fireEvent.click(gatewayRadio as HTMLInputElement);
      const placeOrderButton = screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled'));
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      // Creation is still attributed, but the unpaid zero-due order must
      // not fabricate a paid conversion.
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'order_created',
          'order-123',
          expect.anything()
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );
    } finally {
      fetchMock.mockRestore();
      window.localStorage.clear();
    }
  });

  it('records invoice_generated for a zero-due invoice order the server left unpaid', async () => {
    window.localStorage.clear();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          paystack_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              // A 100% discount zeroes the gateway amount while the order
              // stays unpaid — yet the server still generates and emails a
              // proforma for invoice-method orders.
              amountDueToGateway: 0,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
                payment_method: 'invoice',
                payment_status: 'unpaid',
                total: 0,
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      fireEvent.click(
        screen.getByRole('button', { name: /continue to payment/i })
      );
      fireEvent.click(
        screen.getByRole('button', { name: /get a proforma invoice/i })
      );
      const invoiceRadio = (
        await screen.findAllByRole('radio', { name: /get a proforma invoice/i })
      ).find((radio) => radio.getAttribute('value') === 'invoice');
      expect(invoiceRadio).toBeDefined();
      fireEvent.click(invoiceRadio as HTMLInputElement);
      // The invoice submit button shares its label with the invoice tab;
      // the tab carries aria-pressed, the submit button does not.
      const placeOrderButton = screen
        .getAllByRole('button', { name: 'Get a Proforma Invoice' })
        .find(
          (button) =>
            !button.hasAttribute('aria-pressed') &&
            !button.hasAttribute('disabled')
        );
      expect(placeOrderButton).toBeDefined();
      fireEvent.click(placeOrderButton as HTMLButtonElement);

      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'invoice_generated',
          'order-123',
          expect.objectContaining({
            payment_method: 'invoice',
            payment_status: 'unpaid',
          })
        );
      });
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );
    } finally {
      fetchMock.mockRestore();
      window.localStorage.clear();
    }
  });

  it('clears the idempotency key when the order is no longer reusable', async () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const randomUuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    window.localStorage.clear();
    mockCheckoutSubmissionState();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              code: 'CHECKOUT_ORDER_NOT_REUSABLE',
              details: 'Order is already approved and cannot be reused',
              error: 'Order is not reusable',
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    await submitPickupPayOnDeliveryOrder();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
      ).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
          }),
        })
      );
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).toBeNull();
    });

    fetchMock.mockRestore();
    randomUuidSpy.mockRestore();
    scrollSpy.mockRestore();
    window.localStorage.clear();
  });

  it('clears the idempotency key when checkout idempotency conflicts', async () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const randomUuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    window.localStorage.clear();
    mockCheckoutSubmissionState();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
              error:
                'This checkout request was already used for a different cart, customer, or delivery payload.',
            }),
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    await submitPickupPayOnDeliveryOrder();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
      ).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
          }),
        })
      );
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).toBeNull();
    });

    fetchMock.mockRestore();
    randomUuidSpy.mockRestore();
    scrollSpy.mockRestore();
    window.localStorage.clear();
  });

  it('debounces inferred manual address location updates before mutating checkout location', async () => {
    vi.useFakeTimers();
    const setValue = vi.fn();
    const setValues = vi.fn();

    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '',
        newAddressState: '',
        newAddressCity: '',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue,
      setValues,
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response);

    try {
      const { unmount } = render(<CheckoutPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shipping/locations',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      fireEvent.change(screen.getByTestId('address-input'), {
        target: { value: 'Lekki, Lagos' },
      });

      expect(setValues).toHaveBeenCalledWith({
        newAddressStreet: 'Lekki, Lagos',
        newAddressCity: '',
        newAddressState: '',
        deliveryCoordinates: null,
      });
      setValues.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });

      expect(setValues).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(setValues).toHaveBeenCalledWith({
        newAddressCity: 'Lekki',
        newAddressState: 'Lagos',
      });

      unmount();
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it('clears inferred city/state when manual address parsing no longer succeeds', async () => {
    vi.useFakeTimers();
    const setValue = vi.fn();
    const setValues = vi.fn();

    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '',
        newAddressState: '',
        newAddressCity: '',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue,
      setValues,
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response);

    try {
      render(<CheckoutPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shipping/locations',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      fireEvent.change(screen.getByTestId('address-input'), {
        target: { value: 'Lekki, Lagos' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(setValues).toHaveBeenCalledWith({
        newAddressCity: 'Lekki',
        newAddressState: 'Lagos',
      });

      fireEvent.change(screen.getByTestId('address-input'), {
        target: { value: 'Lekki, Nigeria' },
      });

      expect(setValues).toHaveBeenCalledWith({
        newAddressCity: '',
        newAddressState: '',
      });
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it('invokes calculateCommerce with subtotal excluding assurance and sends quantity-multiplied assurance to /api/orders', async () => {
    vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(true);

    // Set up cart with a negotiated price + assurance + quantity > 1
    const mockCart = [
      {
        id: 'item-1',
        cartItemId: 'ci-1',
        name: 'Test Product',
        price: 5000,
        negotiatedPrice: 4000,
        negotiationStatus: 'accepted' as const,
        quantity: 2,
        image: '',
        slug: 'test-product',
        hasAssurance: true,
        assuranceRate: 0.05,
      },
    ];

    mockCheckoutSubmissionState();
    // Overwrite the cart/cartTotal mock values that mockCheckoutSubmissionState sets
    vi.mocked(useCart).mockReturnValue({
      cart: mockCart,
      cartTotal: 8400, // 4000 * 2 + (4000 * 2 * 0.05) = 8000 + 400 = 8400
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);

    const { calculateCommerce } = await import('@/lib/supabase/client');
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 8000,
      taxAmount: 600, // 8000 * 7.5%
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 9000,
              order: { id: 'order-123', order_number: 'ORD-123', tracking_token: 'track-123' },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // Expect calculateCommerce to be called with itemSubtotal (8000), not checkoutCartTotal (8400)
    await waitFor(() => {
      expect(calculateCommerce).toHaveBeenCalledWith(
        'calculate_order',
        expect.objectContaining({ subtotal: 8000 })
      );
    });

    // Let's submit the order
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    fireEvent.click(await screen.findByText(/pay on delivery/i));
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(placeOrderButton).toBeDefined();
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      const orderCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders');
      expect(orderCall).toBeDefined();
      const body = JSON.parse(orderCall![1]!.body as string);

      // Items assurance fee should be quantity multiplied
      expect(body.items).toEqual([
        expect.objectContaining({
          product_id: 'item-1',
          quantity: 2,
          price: 4000,
          has_assurance: true,
          assurance_fee: 400, // (4000 * 2) * 0.05
        }),
      ]);

      //expected_total = checkoutCartTotal (8400) + deliveryCost (0) + giftWrappingCost (0) + taxAmount (600) = 9000
      expect(body.tax_amount).toBe(600);
      expect(body.expected_total).toBe(9000);
      expect(body.client_total).toBe(9000);
    });

    fetchMock.mockRestore();
  });

  it('strips/ignores negotiated price and cartDiscount when merchant is not entitled', async () => {
    vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(false);

    // Set up cart with a negotiated price + cartDiscount
    const mockCart = [
      {
        id: 'item-1',
        cartItemId: 'ci-1',
        name: 'Test Product',
        price: 5000,
        negotiatedPrice: 4000,
        negotiationStatus: 'accepted' as const,
        cartDiscount: 1000,
        quantity: 2,
        image: '',
        slug: 'test-product',
        hasAssurance: false,
      },
    ];

    mockCheckoutSubmissionState();
    // Overwrite the cart/cartTotal mock values that mockCheckoutSubmissionState sets
    vi.mocked(useCart).mockReturnValue({
      cart: mockCart,
      cartTotal: 10000, // price (5000) * quantity (2) = 10000 (discounts stripped)
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);

    const { calculateCommerce } = await import('@/lib/supabase/client');
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 10000,
      taxAmount: 750, // 10000 * 7.5%
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 10750,
              order: { id: 'order-123', order_number: 'ORD-123', tracking_token: 'track-123' },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // Expect calculateCommerce to be called with baseline subtotal (10000), not negotiated/discounted
    await waitFor(() => {
      expect(calculateCommerce).toHaveBeenCalledWith(
        'calculate_order',
        expect.objectContaining({ subtotal: 10000 })
      );
    });

    // Let's submit the order
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    fireEvent.click(await screen.findByText(/pay on delivery/i));
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(placeOrderButton).toBeDefined();
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      const orderCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders');
      expect(orderCall).toBeDefined();
      const body = JSON.parse(orderCall![1]!.body as string);

      // Items price should be baseline (5000), not negotiated (4000)
      expect(body.items).toEqual([
        expect.objectContaining({
          product_id: 'item-1',
          quantity: 2,
          price: 5000,
        }),
      ]);

      expect(body.tax_amount).toBe(750);
      expect(body.expected_total).toBe(10750);
    });

    fetchMock.mockRestore();
  });

  it('reserves the full order-summary scroll region so multi-item cart hydration does not reflow #main-content', async () => {
    mockCheckoutSubmissionState();

    render(<CheckoutPage />);

    await screen.findAllByText(/secure checkout/i);

    const orderSummary = screen
      .getByRole('heading', { name: /order summary/i })
      .closest('section,aside,div');

    expect(
      orderSummary?.querySelector('[class*="h-[200px]"]')
    ).toBeInTheDocument();
  });

  it('does not reserve an empty fixed-height region below delivery quotes', async () => {
    mockCheckoutSubmissionState();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    const { container } = render(<CheckoutPage />);

    await screen.findByText(/select delivery option/i);

    expect(
      container.querySelector('[class*="h-[320px]"]')
    ).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('populates the address state list from merchant-country subdivisions and biases autocomplete for a non-NG merchant', async () => {
    const setValues = vi.fn();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'IN',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '',
        newAddressState: '',
        newAddressCity: '',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues,
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ states: [], locations: [] }),
      text: async () => '',
    } as Response);

    render(<CheckoutPage />);

    // Google Places autocomplete is biased to the merchant's country.
    const addressInput = await screen.findByTestId('address-input');
    expect(addressInput).toHaveAttribute('country', 'IN');

    // The NG-only /api/shipping/locations dataset is never fetched for a non-NG
    // merchant — the state list comes from the subdivision vocabulary instead.
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/shipping/locations')
      )
    ).toBe(false);

    // Typing "Mumbai, Maharashtra" infers state/city — proving shippingStates
    // was populated from IN subdivisions (contains "Maharashtra"), so the
    // quote-fetch gate (state && city) can now fire for the non-NG shopper.
    fireEvent.change(addressInput, {
      target: { value: 'Mumbai, Maharashtra' },
    });

    await waitFor(() => {
      expect(setValues).toHaveBeenCalledWith({
        newAddressCity: 'Mumbai',
        newAddressState: 'Maharashtra',
      });
    });

    fetchMock.mockRestore();
  });

  it('does not let a stale NG state fetch clobber IN subdivisions when the merchant resolves late', async () => {
    const setValues = vi.fn();
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    // First render sees no merchant, so `merchantCountry` falls back to NG and
    // the NG /api/shipping/locations fetch starts.
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: undefined,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '',
        newAddressState: '',
        newAddressCity: '',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues,
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    // Hold the NG state fetch open so it can resolve AFTER the merchant flips to
    // IN — reproducing the stale-response clobber race.
    let resolveNgStates: (value: Response) => void = () => undefined;
    const ngStatesPromise = new Promise<Response>((resolve) => {
      resolveNgStates = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/locations')) {
          return ngStatesPromise;
        }
        return {
          ok: true,
          json: async () => ({ quotes: { all: [] } }),
          text: async () => '',
        } as Response;
      });

    const { rerender } = render(<CheckoutPage />);

    // The NG dataset fetch is in flight (merchant unresolved → NG fallback).
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/locations')
        )
      ).toBe(true);
    });

    // The merchant resolves to IN; the effect re-runs, sets the IN subdivisions
    // synchronously, and aborts the stale NG request.
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'IN',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    rerender(<CheckoutPage />);

    // Now let the stale NG fetch resolve — it must be ignored, not overwrite IN.
    await act(async () => {
      resolveNgStates({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response);
      await ngStatesPromise;
    });

    // Proof the list ended as IN, not NG: typing an Indian address infers
    // "Maharashtra", which only matches when `shippingStates` holds the IN
    // subdivisions. A clobber to the NG list (['Lagos']) would fail the match.
    const addressInput = await screen.findByTestId('address-input');
    fireEvent.change(addressInput, {
      target: { value: 'Mumbai, Maharashtra' },
    });

    await waitFor(() => {
      expect(setValues).toHaveBeenCalledWith({
        newAddressCity: 'Mumbai',
        newAddressState: 'Maharashtra',
      });
    });

    fetchMock.mockRestore();
  });

  it('skips the NG city sub-fetch for a non-NG address yet still reaches merchant quotes', async () => {
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'not_registered',
        country: 'IN',
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: 'Marine Drive, Mumbai, Maharashtra',
        newAddressState: 'Maharashtra',
        newAddressCity: 'Mumbai',
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // The non-NG destination reaches the merchant quotes endpoint, so
    // merchant-configured rates are now reachable for the IN shopper.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/shipping/quotes')
        )
      ).toBe(true);
    });

    // Neither the NG state list nor the NG state->city sub-fetch ever fires for
    // a non-NG address (the Nigerian /api/shipping/locations dataset is skipped).
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/shipping/locations')
      )
    ).toBe(false);

    expect(await screen.findByTestId('address-input')).toHaveAttribute(
      'country',
      'IN'
    );

    fetchMock.mockRestore();
  });

  it('keeps the NG address form on /api/shipping/locations with an NG-biased autocomplete', async () => {
    mockCheckoutSubmissionState();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/shipping/quotes')) {
          return {
            ok: true,
            json: async () => ({ quotes: { all: [] } }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });

    render(<CheckoutPage />);

    // NG keeps the rich locations dataset load, byte-identical to before.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shipping/locations',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    // Autocomplete stays biased to Nigeria for the pilot market.
    expect(await screen.findByTestId('address-input')).toHaveAttribute(
      'country',
      'NG'
    );

    fetchMock.mockRestore();
  });

  it('emits payment_started only after bank-transfer initialization succeeds', async () => {
    const startedEvents: unknown[][] = [];
    const failedEvents: unknown[][] = [];
    mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'payment_started') startedEvents.push(args);
      if (args[0] === 'payment_failed') failedEvents.push(args);
    });
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      paystack_subaccount_code: 'ACCT_test123',
      feature_settings: {
        bank_transfer_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    let dvaSucceeds = false;

    const submitBankTransfer = async () => {
      vi.mocked(useCart).mockReturnValue({
        cart: [{ id: 'item-1', name: 'Test Product', price: 5000, quantity: 1, image: '', slug: 'test-product' }],
        cartTotal: 5000,
        clearCart: vi.fn(),
        isHydrated: true,
      } as unknown as ReturnType<typeof useCart>);
      vi.mocked(useMerchantSafe).mockReturnValue({ merchant, basePath: '/ogabassey' } as unknown as ReturnType<typeof useMerchantSafe>);
      vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (String(input) === '/api/payments/initialize') {
          if (!dvaSucceeds) {
            return { ok: false, json: async () => ({ error: 'declined' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({
              success: true,
              dva: { account_number: '1234567890', account_name: 'Test', bank_name: 'Test Bank' },
              reference: 'dva-ref-1',
            }),
          } as Response;
        }
        if (String(input) === '/api/orders') {
          return { ok: true, json: async () => ({ amountDueToGateway: 5000, order: { id: 'order-dva', order_number: 'ORD-DVA', total: 5000, payment_status: 'pending', tracking_token: 'track-1' }, wallet: null }) } as Response;
        }
        return { ok: true, json: async () => ({ states: [], locations: [] }) } as Response;
      });

      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      const paymentRadio = screen
        .getAllByRole('radio', { name: /bank transfer/i })
        .find((radio) => radio.getAttribute('value') === 'bank_transfer');
      expect(paymentRadio).toBeDefined();
      fireEvent.click(paymentRadio as HTMLInputElement);
      fireEvent.click(screen.getAllByRole('button', { name: /place order/i }).find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.anything()));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/payments/initialize', expect.anything()));
      fetchMock.mockRestore();
      cleanup();
    };

    await submitBankTransfer();
    // Rejected initialization: the transfer flow never opened, so the
    // failure surfaces as error UI only — no unmatched payment_failed.
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bank Transfer Failed' })
      );
    });
    expect(failedEvents).toHaveLength(0);
    expect(startedEvents).toHaveLength(0);

    dvaSucceeds = true;
    await submitBankTransfer();
    await waitFor(() => expect(startedEvents).toHaveLength(1));
    expect((startedEvents[0][1] as Record<string, unknown>).payment_method).toBe('bank_transfer');
  });

  it('confirms DVA transfers only after the server detects payment', async () => {
    const completedEvents: unknown[][] = [];
    mockCaptureCheckoutFunnelEventOnce.mockImplementation(
      (...args: unknown[]) => {
        if (args[0] === 'payment_completed') completedEvents.push(args);
      }
    );
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      paystack_subaccount_code: 'ACCT_test123',
      feature_settings: {
        bank_transfer_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    let transferDetected = false;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/track-order')) {
          // Authoritative settlement state: the webhook marks the ORDER
          // paid after matching the transfer to the dedicated account. The
          // BAC-* DVA reference is never a Paystack transaction.
          expect(url).toContain('token=track-1');
          expect(url).toContain('merchant_slug=ogabassey');
          return {
            ok: true,
            json: async () => ({
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                payment_status: transferDetected ? 'paid' : 'pending',
                total: 5000,
              },
            }),
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              dva: {
                account_number: '1234567890',
                account_name: 'Test',
                bank_name: 'Test Bank',
              },
              reference: 'dva-ref-1',
            }),
          } as Response;
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                total: 5000,
                payment_status: 'pending',
                tracking_token: 'track-1',
              },
              wallet: null,
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
        } as Response;
      });
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue(paymentForm);

    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    const paymentRadio = screen
      .getAllByRole('radio', { name: /bank transfer/i })
      .find((radio) => radio.getAttribute('value') === 'bank_transfer');
    expect(paymentRadio).toBeDefined();
    fireEvent.click(paymentRadio as HTMLInputElement);
    fireEvent.click(
      screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
    );
    const confirmButton = await screen.findByRole('button', {
      name: /confirm transfer sent/i,
    });

    // Still pending: no completion, no navigation — the modal stays open.
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/storefront/orders/track-order')
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completedEvents).toHaveLength(0);
    expect(routerPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /confirm transfer sent/i })
    ).toBeTruthy();

    // Detected: completion recorded against the created order, then success.
    transferDetected = true;
    fireEvent.click(
      screen.getByRole('button', { name: /confirm transfer sent/i })
    );
    await waitFor(() => {
      expect(completedEvents).toHaveLength(1);
    });
    expect(completedEvents[0]?.[1]).toBe('order-dva');
    expect(completedEvents[0]?.[2]).toEqual(
      expect.objectContaining({
        payment_method: 'bank_transfer',
        payment_status: 'paid',
        reference: 'dva-ref-1',
      })
    );
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining('/order-success?')
      );
    });
    fetchMock.mockRestore();
  });

  it('does not record payment_failed when session storage is blocked before any payment flow', async () => {
    const failedEvents: unknown[][] = [];
    const startedEvents: unknown[][] = [];
    mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'payment_failed') failedEvents.push(args);
      if (args[0] === 'payment_started') startedEvents.push(args);
    });
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Test Store',
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        country: 'NG',
        feature_settings: {
          pay_on_delivery_enabled: true,
        },
      },
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue({
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
    } as unknown as ReturnType<typeof usePersistedForm>);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-123',
                order_number: 'ORD-123',
                tracking_token: 'track-123',
              },
              wallet: null,
            }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: ['Lagos'], locations: [] }),
          text: async () => '',
        } as Response;
      });
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ): void {
        if (key === CHECKOUT_PENDING_ORDER_STORAGE_KEY) {
          throw new Error('session storage blocked');
        }
        originalSetItem.call(this, key, value);
      });

    await submitPickupPayOnDeliveryOrder();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orders',
        expect.anything()
      );
    });
    // The persist failure surfaces as a checkout error, not a payment one.
    await waitFor(() => {
      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Checkout Failed' })
      );
    });
    expect(startedEvents).toHaveLength(0);
    expect(failedEvents).toHaveLength(0);
    setItemSpy.mockRestore();
    fetchMock.mockRestore();
  });

  it('keeps another checkout recovery key when a DVA transfer confirms', async () => {
    const completedEvents: unknown[][] = [];
    mockCaptureCheckoutFunnelEventOnce.mockImplementation(
      (...args: unknown[]) => {
        if (args[0] === 'payment_completed') completedEvents.push(args);
      }
    );
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      paystack_subaccount_code: 'ACCT_test123',
      feature_settings: {
        bank_transfer_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/track-order')) {
          return {
            ok: true,
            json: async () => ({
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                payment_status: 'paid',
                total: 5000,
              },
            }),
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              dva: {
                account_number: '1234567890',
                account_name: 'Test',
                bank_name: 'Test Bank',
              },
              reference: 'dva-ref-1',
            }),
          } as Response;
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                total: 5000,
                payment_status: 'pending',
                tracking_token: 'track-1',
              },
              wallet: null,
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
        } as Response;
      });
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue(paymentForm);

    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    const paymentRadio = screen
      .getAllByRole('radio', { name: /bank transfer/i })
      .find((radio) => radio.getAttribute('value') === 'bank_transfer');
    expect(paymentRadio).toBeDefined();
    fireEvent.click(paymentRadio as HTMLInputElement);
    fireEvent.click(
      screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
    );
    const confirmButton = await screen.findByRole('button', {
      name: /confirm transfer sent/i,
    });

    // Another tab starts a newer checkout while the DVA modal is open.
    const otherTabKey = await getCheckoutIdempotencyKey('other-tab-fingerprint');
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(completedEvents).toHaveLength(1);
    });

    // Completing the older transfer must not delete the newer tab's key.
    const stored = JSON.parse(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
    );
    expect(stored.key).toBe(otherTabKey);
    fetchMock.mockRestore();
  });

  it('records the full order total for DVA completion after wallet credits', async () => {
    const completedEvents: unknown[][] = [];
    mockCaptureCheckoutFunnelEventOnce.mockImplementation(
      (...args: unknown[]) => {
        if (args[0] === 'payment_completed') completedEvents.push(args);
      }
    );
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      paystack_subaccount_code: 'ACCT_test123',
      feature_settings: {
        bank_transfer_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/storefront/orders/track-order')) {
          return {
            ok: true,
            json: async () => ({
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                payment_status: 'paid',
                total: 5750,
              },
            }),
          } as Response;
        }
        if (url === '/api/payments/initialize') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              dva: {
                account_number: '1234567890',
                account_name: 'Test',
                bank_name: 'Test Bank',
              },
              reference: 'dva-ref-1',
            }),
          } as Response;
        }
        if (url === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              // Wallet credits cover all but 750: the DVA receives the
              // residual while revenue stays the full total.
              amountDueToGateway: 750,
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                total: 5750,
                payment_status: 'pending',
                tracking_token: 'track-1',
              },
              wallet: null,
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
        } as Response;
      });
    vi.mocked(useCart).mockReturnValue({
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
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue(paymentForm);

    try {
      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      const paymentRadio = screen
        .getAllByRole('radio', { name: /bank transfer/i })
        .find((radio) => radio.getAttribute('value') === 'bank_transfer');
      expect(paymentRadio).toBeDefined();
      fireEvent.click(paymentRadio as HTMLInputElement);
      fireEvent.click(
        screen
          .getAllByRole('button', { name: /place order/i })
          .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /confirm transfer sent/i })
      );

      // The confirmed transfer records the FULL order total, not the
      // 750 residual the DVA received.
      await waitFor(() => {
        expect(completedEvents).toHaveLength(1);
      });
      expect(completedEvents[0]?.[2]).toEqual(
        expect.objectContaining({
          payment_method: 'bank_transfer',
          payment_status: 'paid',
          reference: 'dva-ref-1',
          total: 5750,
        })
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('routes pending CredPal applications to success without a paid conversion', async () => {
    const completedEvents: unknown[][] = [];
    mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'payment_completed') completedEvents.push(args);
    });
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      paystack_subaccount_configured: true,
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      feature_settings: {
        credpal_enabled: true,
        paystack_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(useCart).mockReturnValue({
      cart: [{ id: 'item-1', name: 'Test Product', price: 5000, quantity: 1, image: '', slug: 'test-product' }],
      cartTotal: 5000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({ merchant, basePath: '/ogabassey' } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/orders') {
        return { ok: true, json: async () => ({ amountDueToGateway: 5000, order: { id: 'order-credpal', order_number: 'ORD-CREDPAL', total: 5000, payment_status: 'pending', tracking_token: 'track-1' }, wallet: null }) } as Response;
      }
      return { ok: true, json: async () => ({ states: [], locations: [] }) } as Response;
    });
    vi.mocked(openCredPalCheckout).mockImplementation(async ({ onSuccess }) => {
      await onSuccess?.({ order_no: 'credpal-pending-1', status: 'pending' } as never);
    });

    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));
    const paymentRadio = screen
      .getAllByRole('radio', { name: /credpal/i })
      .find((radio) => radio.getAttribute('value') === 'credpal');
    expect(paymentRadio).toBeDefined();
    fireEvent.click(paymentRadio as HTMLInputElement);
    fireEvent.click(screen.getAllByRole('button', { name: /place order/i }).find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement);

    await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalled());
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining('/order-success?')
      )
    );
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining('type=credpal')
    );
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining('credpalStatus=pending')
    );
    expect(completedEvents).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it('tracks payment failures from Credit Direct and CredPal callbacks', async () => {
    const paymentErrorEvents: unknown[][] = [];
    mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'payment_failed') paymentErrorEvents.push(args);
    });
    vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
    const merchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      country: 'NG',
      paystack_subaccount_configured: true,
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      feature_settings: {
        bank_transfer_enabled: true,
        credit_direct_enabled: true,
        credpal_enabled: true,
        paystack_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };
    const paymentForm = {
      values: {
        firstName: 'Ada',
        lastName: 'Buyer',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressState: 'Lagos',
        newAddressCity: 'Ikeja',
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      },
      setValue: vi.fn(),
      setValues: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReturnType<typeof usePersistedForm>;
    const routerPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);

    const submitAndCapture = async (tab: 'full' | 'installments', method: string) => {
      const clearCart = vi.fn();
      vi.mocked(useCart).mockReturnValue({
        cart: [{ id: 'item-1', name: 'Test Product', price: 5000, quantity: 1, image: '', slug: 'test-product' }],
        cartTotal: 5000,
        clearCart,
        isHydrated: true,
      } as unknown as ReturnType<typeof useCart>);
      vi.mocked(useMerchantSafe).mockReturnValue({ merchant, basePath: '/ogabassey' } as unknown as ReturnType<typeof useMerchantSafe>);
      vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (String(input) === '/api/payments/initialize') {
          const body = JSON.parse(String(init?.body));
          if (body.payment_type === 'dva') {
            return { ok: false, json: async () => ({ error: 'declined' }) } as Response;
          }
        }
        if (String(input) === '/api/orders') {
          return { ok: true, json: async () => ({ amountDueToGateway: 5000, order: { id: `order-${method}`, order_number: `ORD-${method}`, total: 5000, payment_status: 'pending', tracking_token: 'track-1' }, wallet: null }) } as Response;
        }
        return { ok: true, json: async () => ({ states: [], locations: [] }) } as Response;
      });

      render(<CheckoutPage />);
      fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
      if (tab === 'installments') fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));
      const paymentLabel = method.replace('_', ' ');
      const paymentRadio = screen
        .getAllByRole('radio', { name: new RegExp(paymentLabel, 'i') })
        .find((radio) => radio.getAttribute('value') === method);
      expect(paymentRadio).toBeDefined();
      fireEvent.click(
        paymentRadio as HTMLInputElement
      );
      fireEvent.click(screen.getAllByRole('button', { name: /place order/i }).find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.anything()));

      if (method === 'credit_direct') {
        await waitFor(() => expect(openCreditDirectCheckout).toHaveBeenCalled());
        const options = vi.mocked(openCreditDirectCheckout).mock.calls.at(-1)?.[0];
        expect(options).toBeDefined();
        // Matched error: the popup opened (payment_started), then failed.
        await act(async () => {
          await options?.onPopup?.({
            checkoutTransactionId: 'cd-popup-tracked-1',
            sessionId: 'signed-session-tracked-1',
          });
        });
        await act(async () => {
          options?.onError?.('declined');
        });
      } else if (method === 'credpal') {
        await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalled());
        const options = vi.mocked(openCredPalCheckout).mock.calls.at(-1)?.[0];
        expect(options).toBeDefined();
        // Matched error: the widget loaded (payment_started), then failed.
        await act(async () => {
          options?.onLoad?.();
        });
        await act(async () => {
          options?.onError?.({ success: false, message: 'declined' });
        });
        mockCaptureCheckoutFunnelEventOnce.mockClear();
        await act(async () => {
          await options?.onSuccess?.({
            order_no: 'credpal-order-pending',
            item: 'Test Product',
            amount: 5000,
            status: 'pending',
            channel: 'web',
            customer: {
              full_name: 'Ada Buyer',
              email: 'ada@example.com',
              phone_no: '+2348123456789',
            },
            created_at: '2026-09-14T00:00:00.000Z',
          });
        });
        expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
          'payment_completed',
          expect.anything(),
          expect.anything()
        );
        // Pending applications still reach the success experience.
        expect(clearCart).toHaveBeenCalled();
        expect(routerPush).toHaveBeenCalledWith(
          expect.stringContaining('/order-success?')
        );
        expect(routerPush).toHaveBeenCalledWith(
          expect.stringContaining('credpalStatus=pending')
        );
        await act(async () => {
          await options?.onSuccess?.({
            order_no: 'credpal-order-1',
            item: 'Test Product',
            amount: 5000,
            status: 'success',
            channel: 'web',
            customer: {
              full_name: 'Ada Buyer',
              email: 'ada@example.com',
              phone_no: '+2348123456789',
            },
            created_at: '2026-09-14T00:00:00.000Z',
          });
        });
      } else {
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/payments/initialize', expect.anything()));
      }
      fetchMock.mockRestore();
      cleanup();
    };

    // Bank-transfer initialization failures no longer emit: no DVA was
    // ever ready, so there is no opened flow to match (covered by the
    // bank-transfer initialization test above).
    await submitAndCapture('installments', 'credit_direct');
    await submitAndCapture('installments', 'credpal');

    expect(paymentErrorEvents).toHaveLength(2);
    expect(paymentErrorEvents.map(([, properties]) => (properties as Record<string, unknown>).payment_method)).toEqual([
      'credit_direct',
      'credpal',
    ]);
    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'payment_completed',
      'order-credpal',
      expect.objectContaining({
        payment_method: 'credpal',
        reference: 'credpal-order-1',
      })
    );
    vi.unstubAllEnvs();
  });
});
