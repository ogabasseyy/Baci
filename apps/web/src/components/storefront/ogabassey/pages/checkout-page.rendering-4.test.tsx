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

it('does not let a stale NG state fetch clobber IN subdivisions when the merchant resolves late', async () => {
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
  // First render sees no merchant, so `merchantCountry` falls back to NG and
  // the NG /api/shipping/locations fetch starts.
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: undefined,
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

  // Hold the NG state fetch open so it can resolve AFTER the merchant flips to
  // IN — reproducing the stale-response clobber race.
  let resolveNgStates: (value: Response) => void = () => undefined;
  const ngStatesPromise = new Promise<Response>((resolve) => {
    resolveNgStates = resolve;
  });
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/shipping/locations')) {
        return ngStatesPromise;
      }
      return {
        ok: true,
        json: async () => ({ quotes: { all: [] } }),
        text: async () => '',
      } as Response;
    });

  const { rerender } = render(<CheckoutPage />);

  // The NG dataset fetch is in flight (merchant unresolved → NG fallback).
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/shipping/locations')
      )
    ).toBe(true);
  });

  // The merchant resolves to IN; the effect re-runs, sets the IN subdivisions
  // synchronously, and aborts the stale NG request.
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
  rerender(<CheckoutPage />);

  // Now let the stale NG fetch resolve — it must be ignored, not overwrite IN.
  await act(async () => {
    resolveNgStates({
      ok: true,
      json: async () => ({ states: ['Lagos'], locations: [] }),
      text: async () => '',
    } as Response);
    await ngStatesPromise;
  });

  // Proof the list ended as IN, not NG: typing an Indian address infers
  // "Maharashtra", which only matches when `shippingStates` holds the IN
  // subdivisions. A clobber to the NG list (['Lagos']) would fail the match.
  const addressInput = await screen.findByTestId('address-input');
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
