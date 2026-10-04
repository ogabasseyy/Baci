import {
  act,
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
