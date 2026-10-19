import {
  CheckoutPage,
  expect,
  hasPriceNegotiationEntitlement,
  it,
  render,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('quotes merchant rates against the catalog subtotal, not the negotiated total', async () => {
  vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(true);
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        cartItemId: 'ci-1',
        name: 'Test Product',
        price: 5000,
        negotiatedPrice: 4000,
        negotiationStatus: 'accepted' as const,
        quantity: 2,
        image: '',
        slug: 'test-product',
        hasAssurance: true,
        assuranceRate: 0.05,
      },
    ],
    cartTotal: 8400,
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
  const body = JSON.parse(String(quoteCall?.[1]?.body));

  // Catalog goods (5000 x 2 = 10000) + negotiated-basis assurance
  // (4000 x 2 x 0.05 = 400) = 10400 — NOT the negotiated total (8400).
  expect(body.cart_subtotal).toBe(10400);

  fetchMock.mockRestore();
});

it('re-quotes when toggling assurance shifts the catalog subtotal without changing the item fingerprint', async () => {
  const baseItem = {
    id: 'item-1',
    name: 'Test Product',
    price: 5000,
    quantity: 2,
    image: '',
    slug: 'test-product',
  };
  vi.mocked(useCart).mockReturnValue({
    cart: [baseItem],
    cartTotal: 10000,
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

  const quoteSubtotals = () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url).startsWith('/api/shipping/quotes'))
      .map(([, init]) => JSON.parse(String(init?.body)).cart_subtotal);

  const { rerender } = render(<CheckoutPage />);

  // First quote uses the assurance-off catalog subtotal (5000 x 2 = 10000).
  await waitFor(() => {
    expect(quoteSubtotals()).toContain(10000);
  });

  // Toggle assurance ON. Same id/quantity/price, so `quoteItemsFingerprint`
  // (id:quantity:price) is byte-for-byte identical, but the catalog subtotal
  // now includes the assurance fee (5000 x 2 x 0.05 = 500) -> 10500.
  vi.mocked(useCart).mockReturnValue({
    cart: [{ ...baseItem, hasAssurance: true, assuranceRate: 0.05 }],
    cartTotal: 10500,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);

  rerender(<CheckoutPage />);

  // The subtotal-basis change must re-trigger the quote fetch even though the
  // item fingerprint never changed (regression: stale fee -> order-time
  // SHIPPING_FEE_MISMATCH for merchant free-over / price-tier rates).
  await waitFor(() => {
    expect(quoteSubtotals()).toContain(10500);
  });

  fetchMock.mockRestore();
});
