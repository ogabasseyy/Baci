import {
  addressAutocompleteMock,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  render,
  screen,
  toast,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('blocks order creation when door delivery has no selected quote', async () => {
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
      paystack_subaccount_code: 'ACCT_test',
      feature_settings: {
        pay_on_delivery_enabled: true,
        paystack_enabled: true,
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
      newAddressStreet: 'Obafemi Awolowo Way',
      newAddressState: 'Lagos',
      newAddressCity: 'Lagos',
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
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
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response;
    });

  render(<CheckoutPage />);

  fireEvent.click(screen.getByText(/pay on delivery/i));
  const placeOrderButton = screen
    .getAllByRole('button', { name: /place order/i })
    .find((button) => !button.hasAttribute('disabled'));
  expect(placeOrderButton).toBeDefined();
  fireEvent.click(placeOrderButton as HTMLButtonElement);

  await waitFor(() => {
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Select Delivery Option',
      })
    );
  });
  expect(
    fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
  ).toBe(false);

  fetchMock.mockRestore();
});

it('refetches quotes with new coordinates when the selected place stays in the same city', async () => {
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
      newAddressStreet: 'Old address, Ikeja',
      newAddressState: 'Lagos',
      newAddressCity: 'Ikeja',
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);
  addressAutocompleteMock.selectedPlace = {
    city: 'Ikeja',
    formattedAddress: 'New address, Ikeja',
    location: { latitude: 6.6018, longitude: 3.3515 },
    state: 'Lagos',
  };

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      if (String(input).startsWith('/api/shipping/quotes')) {
        return {
          ok: true,
          json: async () => ({ quotes: { all: [] } }),
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
  fetchMock.mockClear();

  fireEvent.click(screen.getByTestId('select-address-place'));

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
  expect(JSON.parse(String(quoteCall?.[1]?.body)).receiver).toEqual(
    expect.objectContaining({ latitude: 6.6018, longitude: 3.3515 })
  );

  fetchMock.mockRestore();
});
