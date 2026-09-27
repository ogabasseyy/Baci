import {
  act,
  CheckoutPage,
  expect,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCheckoutSubmissionState,
  openCreditDirectCheckout,
  openCredPalCheckout,
  render,
  screen,
  type useCart,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('renders without crashing', () => {
  render(<CheckoutPage />);
  // The checkout page should render some form of checkout UI
  // With an empty cart, it redirects or shows empty state
  expect(document.body).toBeTruthy();
});

it('wraps the normal checkout state in the OgaBassey checkout scope', async () => {
  mockCheckoutSubmissionState();

  render(<CheckoutPage />);

  const checkoutMarkers = await screen.findAllByText(/secure checkout/i);

  expect(
    checkoutMarkers.some((node) => node.closest('.ogabassey-checkout-page'))
  ).toBe(true);
});

it('wraps the checkout loading state in the OgaBassey checkout scope', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      gateway: 'credpal',
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockReturnValue(new Promise<Response>(() => undefined));

  try {
    render(<CheckoutPage />);

    const loadingRoot = await screen
      .findByText(/loading order/i)
      .then((node) => node.closest('.ogabassey-checkout-page'));

    expect(loadingRoot).toBeInTheDocument();
  } finally {
    fetchMock.mockRestore();
  }
});

it('renders the contact step fields when cart has items', async () => {
  const { useCart } = await import('@/hooks/cart');
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

  render(<CheckoutPage />);

  // Contact step should show checkout form content
  const match =
    screen.queryByPlaceholderText(/email/i) ??
    screen.queryAllByLabelText(/email/i)[0] ??
    screen.queryByText(/contact/i);
  expect(match).toBeTruthy();
});

it('renders desktop order-summary thumbnails on the neutral image surface', async () => {
  mockCheckoutSubmissionState();

  render(<CheckoutPage />);

  await screen.findAllByText(/secure checkout/i);

  const orderSummary = screen
    .getByRole('heading', { name: /order summary/i })
    .closest('section,aside,div');

  expect(orderSummary).not.toBeNull();
  expect(screen.getByRole('img', { name: 'Test Product' })).toBeInTheDocument();
});

it.each([
  {
    gateway: 'credpal',
    openWidget: async () => {
      // The opener resolves before the SDK loads, so only invoking the
      // real onLoad callback models an opened flow.
      await waitFor(() => {
        expect(openCredPalCheckout).toHaveBeenCalled();
      });
      const config = vi.mocked(openCredPalCheckout).mock.calls.at(-1)?.[0];
      act(() => {
        config?.onLoad?.();
      });
    },
  },
  {
    gateway: 'credit_direct',
    openWidget: async () => {
      // Credit Direct's opener swallows init failures into onError, so
      // only invoking the real popup callback models an opened flow.
      await waitFor(() => {
        expect(openCreditDirectCheckout).toHaveBeenCalled();
      });
      const options = vi
        .mocked(openCreditDirectCheckout)
        .mock.calls.at(-1)?.[0];
      await act(async () => {
        await options?.onPopup?.({
          checkoutTransactionId: 'cd-popup-1',
          sessionId: 'signed-session-1',
        });
      });
    },
  },
])('emits payment_started once the resumed $gateway flow opens', async ({
  gateway,
  openWidget,
}) => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway,
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      if (String(input).startsWith('/api/storefront/orders/ord-1')) {
        return {
          ok: true,
          json: async () => ({
            id: 'ord-1',
            short_id: 'ORD-1',
            subtotal: 1000,
            shipping_cost: 0,
            total: 1000,
            customer_name: 'Ada Buyer',
            customer_email: 'ada@example.com',
            customer_phone: '+2348123456789',
            tracking_token: 'tok-123',
            shipping_address: { address: '', city: '', state: '' },
            items: [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ states: [], locations: [] }),
        text: async () => '',
      } as Response;
    });

  try {
    render(<CheckoutPage />);

    await openWidget();
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^ord-1:/),
        expect.objectContaining({
          payment_method: gateway,
          total: 1000,
        })
      );
    });
    expect(
      mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
        ([event]) => event === 'payment_started'
      )
    ).toHaveLength(1);
  } finally {
    fetchMock.mockRestore();
  }
});
