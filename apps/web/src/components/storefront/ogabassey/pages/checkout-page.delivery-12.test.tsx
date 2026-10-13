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
