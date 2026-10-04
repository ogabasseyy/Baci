import {
  driveFreshBNPLPlaceOrder,
  paymentStartedCalls,
  renderFreshBNPLCheckout,
} from './checkout-page-bnpl.test-support';
import {
  act,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  openCreditDirectCheckout,
  openCredPalCheckout,
  readCreditDirectPopupMarker,
  render,
  screen,
  toast,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  usePersistedState,
  useRouter,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('hands fresh Credit Direct success to server verification before cleanup', async () => {
  const clearCart = vi.fn();
  const clearCheckoutSession = vi.fn();
  const clearPendingCheckoutOrder = vi.fn();
  const routerPush = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
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
    clearCart,
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
      feature_settings: {
        credit_direct_enabled: true,
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
    clear: clearCheckoutSession,
  } as unknown as ReturnType<typeof usePersistedForm>);
  vi.mocked(usePersistedState).mockReturnValue([
    null,
    vi.fn(),
    clearPendingCheckoutOrder,
  ] as unknown as ReturnType<typeof usePersistedState>);
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: 'order-cd',
              order_number: 'ORD-CD',
              tracking_token: 'track-cd',
            },
            wallet: null,
          }),
          text: async () => '',
        } as Response;
      }
      if (url === '/api/orders/credit-direct/client-completion') {
        return {
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: async () => 'write failed',
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
    fireEvent.click(
      await screen.findByRole('button', { name: /pay in installments/i })
    );
    fireEvent.click(
      await screen.findByRole('radio', { name: /credit direct/i })
    );
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(placeOrderButton).toBeDefined();
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];

    await act(async () => {
      await callArgs?.onSuccess({
        checkoutTransactionId: 'cd-client-success-2',
        sessionId: 'signed-session-2',
      });
    });

    expect(readCreditDirectPopupMarker('order-cd')?.transactionId).toBe(
      'cd-client-success-2'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order-cd',
          checkoutTransactionId: 'cd-client-success-2',
          customerEmail: 'ada@example.com',
          sessionId: 'signed-session-2',
          tracking_token: 'track-cd',
        }),
      }
    );
    expect(routerPush).toHaveBeenCalledWith(
      '/ogabassey/checkout/bnpl?orderId=order-cd&gateway=credit_direct&merchant_slug=ogabassey&creditDirectCompletion=cd-client-success-2&trackingToken=track-cd&email=ada%40example.com'
    );
    expect(
      routerPush.mock.calls.some(([href]) =>
        String(href).includes('/order-success')
      )
    ).toBe(false);
    expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(clearCheckoutSession).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  }
});

it('skips payment_started when fresh CredPal initialization fails', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-fresh-fail',
  });
  vi.mocked(openCredPalCheckout).mockRejectedValueOnce(
    new Error('Failed to load CredPal script')
  );

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
    expect(paymentStartedCalls()).toHaveLength(0);
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});
