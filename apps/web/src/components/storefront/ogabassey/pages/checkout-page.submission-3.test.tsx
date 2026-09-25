import {
  CheckoutPage,
  cleanup,
  expect,
  fireEvent,
  it,
  mockCaptureClientEvent,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('stamps retried gateway starts with each issued reference', async () => {
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

  // The retried pending order reuses its id; initialization issues a
  // fresh reference per attempt.
  let initCount = 0;
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/payments/initialize') {
        initCount += 1;
        return Response.json({
          success: true,
          authorization_url: `https://checkout.paystack.com/auth-${initCount}`,
          reference: `pay-ref-${initCount}`,
        });
      }
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
              payment_method: 'paystack',
              payment_status: 'pending',
              total: 5750,
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
  const assignSpy = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  });

  const drivePaystackPlaceOrder = async () => {
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
  };

  try {
    await drivePaystackPlaceOrder();
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledTimes(1);
    });

    // Retry after returning: remount for a fresh in-flight guard while
    // the order id stays the same.
    cleanup();
    window.localStorage.clear();
    await drivePaystackPlaceOrder();
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledTimes(2);
    });

    const starts = mockCaptureClientEvent.mock.calls.filter(
      ([event]) => event === 'payment_started'
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]?.[1]).toEqual(
      expect.objectContaining({
        order_id: 'order-123',
        reference: 'pay-ref-1',
      })
    );
    expect(starts[1]?.[1]).toEqual(
      expect.objectContaining({
        order_id: 'order-123',
        reference: 'pay-ref-2',
      })
    );
  } finally {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    fetchMock.mockRestore();
    window.localStorage.clear();
  }
});
