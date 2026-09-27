import {
  act,
  CheckoutPage,
  expect,
  it,
  openCreditDirectCheckout,
  render,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('persists resumed Credit Direct popup references for webhook reconciliation', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credit_direct',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
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

      return {
        ok: true,
        json: async () => ({ states: [], locations: [] }),
        text: async () => (typeof init?.body === 'string' ? init.body : ''),
      } as Response;
    });

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(openCreditDirectCheckout).toHaveBeenCalled();
  });

  const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
  await act(async () => {
    await callArgs?.onPopup?.({
      checkoutTransactionId: 'cd-popup-transaction-1',
      sessionId: 'signed-session-1',
    });
  });

  expect(fetchMock).toHaveBeenCalledWith('/api/orders/update-payment-ref', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: 'ord-1',
      paymentRef: 'cd-popup-transaction-1',
      gateway: 'credit_direct',
      tracking_token: 'tok-123',
    }),
  });

  fetchMock.mockRestore();
});

it('logs resumed Credit Direct popup reference persistence failures', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credit_direct',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => {});
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

      if (url === '/api/orders/update-payment-ref') {
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

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(openCreditDirectCheckout).toHaveBeenCalled();
  });

  const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
  await act(async () => {
    await callArgs?.onPopup?.({
      checkoutTransactionId: 'cd-popup-transaction-1',
      sessionId: 'signed-session-1',
    });
  });

  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Failed to persist Credit Direct popup reference:',
    expect.stringContaining('ord-1')
  );
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Failed to persist Credit Direct popup reference:',
    expect.stringContaining('cd-popup-transaction-1')
  );

  fetchMock.mockRestore();
  consoleErrorSpy.mockRestore();
});
