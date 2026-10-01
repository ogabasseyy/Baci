import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  render,
  screen,
  useCart,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

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
    stationAddress: string
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
                        '10 Aba Road, Port Harcourt'
                      ),
                      stationQuote(
                        'station-2',
                        'Trans Amadi Service Centre',
                        '5 Trans Amadi Road, Port Harcourt'
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
              'pickup_station'
        )
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
