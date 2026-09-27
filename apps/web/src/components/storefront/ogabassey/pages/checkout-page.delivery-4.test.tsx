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
