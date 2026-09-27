import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it.each([
  'delivery',
  'korapay',
])('persists the merchant country for a non-NG order paid with %s and a Nigerian phone', async (method) => {
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
        return Response.json({
          success: true,
          authorization_url: 'https://checkout.paystack.com/test',
          reference: 'reference',
        });
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

  fireEvent.click(
    await screen.findByText(
      method === 'delivery' ? /pay on delivery/i : /^Korapay$/
    )
  );
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
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url) === '/api/payments/initialize'
        )
      ).toBe(true)
    );
    const initialization = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/payments/initialize'
    );
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
