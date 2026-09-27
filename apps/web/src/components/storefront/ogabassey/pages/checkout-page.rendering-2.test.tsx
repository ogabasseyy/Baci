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
