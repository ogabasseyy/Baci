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
