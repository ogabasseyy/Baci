import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  CheckoutPage,
  expect,
  fireEvent,
  hasPriceNegotiationEntitlement,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  submitPickupPayOnDeliveryOrder,
  useCart,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('clears the idempotency key when checkout idempotency conflicts', async () => {
  const scrollSpy = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation(() => undefined);
  const randomUuidSpy = vi
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue('11111111-1111-4111-8111-111111111111');
  window.localStorage.clear();
  mockCheckoutSubmissionState();

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
            error:
              'This checkout request was already used for a different cart, customer, or delivery payload.',
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

  await submitPickupPayOnDeliveryOrder();

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
    ).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        }),
      })
    );
  });
  await waitFor(() => {
    expect(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
    ).toBeNull();
  });

  fetchMock.mockRestore();
  randomUuidSpy.mockRestore();
  scrollSpy.mockRestore();
  window.localStorage.clear();
});

it('strips/ignores negotiated price and cartDiscount when merchant is not entitled', async () => {
  vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(false);

  // Set up cart with a negotiated price + cartDiscount
  const mockCart = [
    {
      id: 'item-1',
      cartItemId: 'ci-1',
      name: 'Test Product',
      price: 5000,
      negotiatedPrice: 4000,
      negotiationStatus: 'accepted' as const,
      cartDiscount: 1000,
      quantity: 2,
      image: '',
      slug: 'test-product',
      hasAssurance: false,
    },
  ];

  mockCheckoutSubmissionState();
  // Overwrite the cart/cartTotal mock values that mockCheckoutSubmissionState sets
  vi.mocked(useCart).mockReturnValue({
    cart: mockCart,
    cartTotal: 10000, // price (5000) * quantity (2) = 10000 (discounts stripped)
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
            amountDueToGateway: 10750,
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

    // Items price should be baseline (5000), not negotiated (4000)
    expect(body.items).toEqual([
      expect.objectContaining({
        product_id: 'item-1',
        quantity: 2,
        price: 5000,
      }),
    ]);

    expect(body.tax_amount).toBe(750);
    expect(body.expected_total).toBe(10750);
  });

  fetchMock.mockRestore();
});
