import {
  CheckoutPage,
  expect,
  it,
  render,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

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
