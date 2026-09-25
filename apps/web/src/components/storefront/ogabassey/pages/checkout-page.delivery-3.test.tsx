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
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
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
