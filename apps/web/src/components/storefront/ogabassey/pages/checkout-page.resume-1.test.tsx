import { resumedOrderPayload } from './checkout-page-bnpl.test-support';
import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockMobileOrderSummary,
  openCredPalCheckout,
  render,
  screen,
  useAuthSafe,
  useCart,
  usePersistedState,
  useRouter,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('shows the canonical due amount without wallet credit for a resumed order', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(useAuthSafe).mockReturnValue({
    user: {
      id: 'customer-1',
      email: 'ada@example.com',
      user_metadata: {},
    },
  } as unknown as ReturnType<typeof useAuthSafe>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) => {
      if (String(input).startsWith('/api/storefront/orders/ord-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...resumedOrderPayload('NGN'),
            total: 5_750,
            subtotal: 5_000,
            tax_amount: 0,
            shipping_cost: 750,
          }),
        } as Response);
      }
      if (String(input).startsWith('/api/storefront/customer/wallet')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ balance: 1_000 }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

  try {
    render(<CheckoutPage />);
    await waitFor(() => {
      const calls = vi.mocked(mockMobileOrderSummary).mock.calls;
      expect(calls.at(-1)?.[0].remainingAmount).toBe(5_750);
      expect(calls.at(-1)?.[0].walletAmountUsed).toBe(0);
      expect(calls.at(-1)?.[0].payWithWallet).toBe(false);
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('does not hydrate resumed fields over an authoritative active cart', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      gateway: 'credpal',
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'active-cart-item',
        cartItemId: 'active-cart-item',
        name: 'Active cart item',
        price: 10_000,
        quantity: 1,
      },
    ],
    cartTotal: 10_000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

  try {
    render(<CheckoutPage />);
    await waitFor(() => expect(mockMobileOrderSummary).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/storefront/orders/ord-1')
      )
    ).toBe(false);
    expect(openCredPalCheckout).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});

it('keeps active-cart checkout visible without starting resume lookup', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'active-cart-item',
        cartItemId: 'active-cart-item',
        name: 'Active cart item',
        price: 10_000,
        quantity: 1,
      },
    ],
    cartTotal: 10_000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);

  try {
    render(<CheckoutPage />);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/api/storefront/orders/ord-1')
        )
      ).toBe(false);
      expect(mockMobileOrderSummary).toHaveBeenCalled();
      expect(screen.queryByText('Loading order...')).not.toBeInTheDocument();
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('keeps active-cart checkout visible without a resume error state', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'active-cart-item',
        cartItemId: 'active-cart-item',
        name: 'Active cart item',
        price: 10_000,
        quantity: 1,
      },
    ],
    cartTotal: 10_000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);

  try {
    render(<CheckoutPage />);
    await waitFor(() => expect(mockMobileOrderSummary).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/storefront/orders/ord-1')
      )
    ).toBe(false);
    expect(
      vi.mocked(mockMobileOrderSummary).mock.calls.at(-1)?.[0].cart
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'active-cart-item' }),
      ])
    );
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  } finally {
    fetchMock.mockRestore();
  }
});

it('wraps the resume-error state in the OgaBassey checkout scope', async () => {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      gateway: 'credpal',
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  try {
    render(<CheckoutPage />);

    const errorRoot = await screen.findByRole('heading', {
      name: 'Something Went Wrong',
    });

    expect(errorRoot).toBeInTheDocument();
    expect(errorRoot.closest('.ogabassey-checkout-page')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Order not found. It may have been completed or expired.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Homepage' }));
    fireEvent.click(screen.getByRole('button', { name: 'contact support' }));
    expect(push).toHaveBeenNthCalledWith(1, '/ogabassey');
    expect(push).toHaveBeenNthCalledWith(2, '/ogabassey/contact');
  } finally {
    fetchMock.mockRestore();
  }
});

it('includes merchant_slug and tracking token when resuming an order', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});

it('includes a persisted customer email alongside the tracking token when resuming an order', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(usePersistedState).mockReturnValue([
    {
      orderId: 'ord-1',
      merchantId: 'merchant-1',
      customerEmail: 'resume@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint',
      amountDueToGateway: 1000,
      createdAt: '2026-04-18T00:00:00.000Z',
    },
    vi.fn(),
    vi.fn(),
  ] as unknown as ReturnType<typeof usePersistedState>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123&email=resume%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});

it('falls back to the persisted customer email for legacy resume links without a token', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(usePersistedState).mockReturnValue([
    {
      orderId: 'ord-1',
      merchantId: 'merchant-1',
      customerEmail: 'legacy@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint',
      amountDueToGateway: 1000,
      createdAt: '2026-04-18T00:00:00.000Z',
    },
    vi.fn(),
    vi.fn(),
  ] as unknown as ReturnType<typeof usePersistedState>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&email=legacy%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});
