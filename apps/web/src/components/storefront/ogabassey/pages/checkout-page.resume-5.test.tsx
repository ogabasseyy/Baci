import {
  act,
  CheckoutPage,
  expect,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  openCreditDirectCheckout,
  readCreditDirectPopupMarker,
  render,
  toast,
  usePersistedForm,
  useRouter,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('hands resumed Credit Direct success to server verification before cleanup', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credit_direct',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const routerPush = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
  const clearCheckoutSession = vi.fn();
  vi.mocked(usePersistedForm).mockReturnValue({
    values: {
      firstName: '',
      lastName: '',
      customerEmail: '',
      customerPhone: '',
      newAddressStreet: '',
      newAddressState: '',
      newAddressCity: '',
      currentStep: 'contact',
      completedSteps: { contact: false, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: clearCheckoutSession,
  } as unknown as ReturnType<typeof usePersistedForm>);
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/storefront/orders/ord-1')) {
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
        json: async () => ({ states: [], locations: [] }),
        text: async () => '',
      } as Response;
    });

  try {
    render(<CheckoutPage />);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];

    await act(async () => {
      await callArgs?.onSuccess({
        checkoutTransactionId: 'cd-client-success-1',
        sessionId: 'signed-session-1',
      });
    });

    expect(readCreditDirectPopupMarker('ord-1')?.transactionId).toBe(
      'cd-client-success-1'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'ord-1',
          checkoutTransactionId: 'cd-client-success-1',
          customerEmail: 'ada@example.com',
          sessionId: 'signed-session-1',
          tracking_token: 'tok-123',
        }),
      }
    );
    expect(routerPush).toHaveBeenCalledWith(
      '/ogabassey/checkout/bnpl?orderId=ord-1&gateway=credit_direct&merchant_slug=ogabassey&creditDirectCompletion=cd-client-success-1&trackingToken=tok-123&email=ada%40example.com'
    );
    expect(
      routerPush.mock.calls.some(([href]) =>
        String(href).includes('/order-success')
      )
    ).toBe(false);
    expect(clearCheckoutSession).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  }
});

it('skips payment_started when resumed Credit Direct initialization fails', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credit_direct',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  // Mirror the opener's catch-and-resolve contract: init failure reaches
  // onError without ever opening a popup.
  vi.mocked(openCreditDirectCheckout).mockImplementationOnce(
    async ({ onError }) => {
      onError?.('Failed to initialize Credit Direct');
    }
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

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    // Let the error path settle, then assert no start was recorded.
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Payment Failed' })
      );
    });
    expect(
      mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
        ([event]) => event === 'payment_started'
      )
    ).toHaveLength(0);
  } finally {
    fetchMock.mockRestore();
  }
});
