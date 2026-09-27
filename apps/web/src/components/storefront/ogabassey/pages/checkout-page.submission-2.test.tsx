import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCheckoutSubmissionState,
  render,
  screen,
  submitPickupPayOnDeliveryOrder,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('does not record completion for a zero-due order the server left unpaid', async () => {
  window.localStorage.clear();
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
        paystack_enabled: true,
        korapay_enabled: true,
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
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            // A 100% discount zeroes the gateway amount, but the orders
            // API leaves payment_status unpaid: no provider or server
            // payment confirmation occurred.
            amountDueToGateway: 0,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
              payment_method: 'paystack',
              payment_status: 'unpaid',
              total: 0,
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

  try {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    const gatewayRadio = (
      await screen.findAllByRole('radio', { name: /paystack/i })
    ).find((radio) => radio.getAttribute('value') === 'paystack');
    expect(gatewayRadio).toBeDefined();
    fireEvent.click(gatewayRadio as HTMLInputElement);
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    // Creation is still attributed, but the unpaid zero-due order must
    // not fabricate a paid conversion.
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'order_created',
        'order-123',
        expect.anything()
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  } finally {
    fetchMock.mockRestore();
    window.localStorage.clear();
  }
});

it('clears the idempotency key when the order is no longer reusable', async () => {
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
            code: 'CHECKOUT_ORDER_NOT_REUSABLE',
            details: 'Order is already approved and cannot be reused',
            error: 'Order is not reusable',
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
