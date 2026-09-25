import {
  CheckoutPage,
  fireEvent,
  mockCaptureClientEvent,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  usePersistedState,
  vi,
} from './checkout-page-test-support';

export function resumedOrderPayload(currency: string) {
  return {
    id: 'ord-1',
    short_id: 'ORD-1',
    subtotal: 5000,
    shipping_cost: 750,
    tax_amount: 0,
    discount_amount: 0,
    gift_wrapping_fee: 0,
    total: 5750,
    currency,
    customer_name: 'Ada Buyer',
    customer_email: 'ada@example.com',
    customer_phone: '+2348123456789',
    tracking_token: 'tok-123',
    items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product_name: 'Test Product',
        quantity: 1,
        price: 5000,
      },
    ],
  };
}

export function mockResumeFetch(currency: string) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    if (String(input).startsWith('/api/storefront/orders/ord-1')) {
      return Promise.resolve({
        ok: true,
        json: async () => resumedOrderPayload(currency),
        text: async () => '',
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);
  });
}

export const renderFreshBNPLCheckout = ({
  featureSettings,
  orderId,
  orderTotal,
}: {
  featureSettings: Record<string, boolean | number>;
  orderId: string;
  /** Canonical order total: when set, differs from the residual gateway due. */
  orderTotal?: number;
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
    .mockImplementation((input) => {
      if (String(input) === '/api/orders') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: orderId,
              order_number: 'ORD-BNPL',
              tracking_token: 'track-bnpl',
              ...(orderTotal === undefined ? {} : { total: orderTotal }),
            },
            wallet: null,
          }),
          text: async () => '',
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response);
    });
  return { fetchMock };
};

export const driveFreshBNPLPlaceOrder = async (radioName: RegExp) => {
  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
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

export const paymentStartedCalls = () =>
  mockCaptureClientEvent.mock.calls.filter(
    ([event]) => event === 'payment_started'
  );
