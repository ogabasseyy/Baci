import {
  CheckoutPage,
  expect,
  fireEvent,
  hasPriceNegotiationEntitlement,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  useCart,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('previews tax from subtotal excluding assurance and sends quantity-multiplied assurance to /api/orders', async () => {
  vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(true);

  // Set up cart with a negotiated price + assurance + quantity > 1
  const mockCart = [
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
  ];

  mockCheckoutSubmissionState();
  // Overwrite the cart/cartTotal mock values that mockCheckoutSubmissionState sets
  vi.mocked(useCart).mockReturnValue({
    cart: mockCart,
    cartTotal: 8400, // 4000 * 2 + (4000 * 2 * 0.05) = 8000 + 400 = 8400
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 9000,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
            },
            wallet: null,
          }),
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

  // Let's submit the order
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByText(/pay on delivery/i));
  const placeOrderButton = screen
    .getAllByRole('button', { name: /place order/i })
    .find((button) => !button.hasAttribute('disabled'));
  expect(placeOrderButton).toBeDefined();
  fireEvent.click(placeOrderButton as HTMLButtonElement);

  await waitFor(() => {
    const orderCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/orders'
    );
    expect(orderCall).toBeDefined();
    const body = JSON.parse(orderCall?.[1]?.body as string);

    // Items assurance fee should be quantity multiplied
    expect(body.items).toEqual([
      expect.objectContaining({
        product_id: 'item-1',
        quantity: 2,
        price: 4000,
        has_assurance: true,
        assurance_fee: 400, // (4000 * 2) * 0.05
      }),
    ]);

    // expected_total = checkoutCartTotal (8400) + deliveryCost (0) + giftWrappingCost (0) + taxAmount (600) = 9000
    expect(body.tax_amount).toBe(600);
    expect(body.expected_total).toBe(9000);
    expect(body.client_total).toBe(9000);
  });

  fetchMock.mockRestore();
});

it('does not reserve an empty fixed-height region below delivery quotes', async () => {
  mockCheckoutSubmissionState();

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

  const { container } = render(<CheckoutPage />);

  await screen.findByText(/select delivery option/i);

  expect(
    container.querySelector('[class*="h-[320px]"]')
  ).not.toBeInTheDocument();

  fetchMock.mockRestore();
});

it('keeps the NG address form on /api/shipping/locations with an NG-biased autocomplete', async () => {
  mockCheckoutSubmissionState();

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

  // NG keeps the rich locations dataset load, byte-identical to before.
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shipping/locations',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  // Autocomplete stays biased to Nigeria for the pilot market.
  expect(await screen.findByTestId('address-input')).toHaveAttribute(
    'country',
    'NG'
  );

  fetchMock.mockRestore();
});
