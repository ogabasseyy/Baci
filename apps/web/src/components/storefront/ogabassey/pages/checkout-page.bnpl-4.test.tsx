import {
  driveFreshBNPLPlaceOrder,
  paymentStartedCalls,
  renderFreshBNPLCheckout,
} from './checkout-page-bnpl.test-support';
import {
  act,
  expect,
  it,
  mockCaptureClientEvent,
  openCreditDirectCheckout,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('defers the Klump start to the launcher instead of firing before navigation', async () => {
  const launcherUrl =
    'https://ogabassey.com/ogabassey/checkout/bnpl?gateway=klump&orderId=order-klump-web';
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { klump_enabled: true, klump_min_amount: 1000 },
    orderId: 'order-klump-web',
  });
  void fetchMock;
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/orders') {
      // Klump requires the full order total: echo the client's own
      // expected_total so the wallet-credit gate sees no residual.
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}'
      ) as { expected_total?: unknown };
      const total =
        typeof body.expected_total === 'number' ? body.expected_total : 5000;
      return {
        ok: true,
        json: async () => ({
          amountDueToGateway: total,
          order: {
            id: 'order-klump-web',
            order_number: 'BAC-KLUMP-WEB',
            status: 'pending',
            total,
            tracking_token: 'track-klump-web',
          },
          wallet: { newBalance: 0, amountDebited: 0 },
        }),
        text: async () => '',
      } as Response;
    }
    if (String(input) === '/api/payments/initialize') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          authorization_url: launcherUrl,
          reference: 'BAC-KLUMP-1',
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
  try {
    await driveFreshBNPLPlaceOrder(/klump/i);

    // Navigation to the launcher still happens; the launcher records
    // the start from Klump's onOpen. Firing here would strand an
    // unmatched start when the launcher lookup, SDK load, or widget
    // fails before Klump opens.
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(launcherUrl);
    });
    expect(paymentStartedCalls()).toHaveLength(0);
    expect(
      mockCaptureClientEvent.mock.calls.some(
        ([event]) => event === 'payment_failed'
      )
    ).toBe(false);
  } finally {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    fetchMock.mockRestore();
  }
});

it('tracks payment_failed when Credit Direct errors after the popup opens', async () => {
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credit_direct_enabled: true },
    orderId: 'order-cd-matched-error',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credit direct/i);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    await act(async () => {
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-matched-1',
        sessionId: 'signed-session-matched-1',
      });
    });
    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });

    await act(async () => {
      callArgs?.onError?.('declined');
    });

    await waitFor(() => {
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(true);
    });
    // The failure reconciles to the same popup attempt as its start.
    const failure = mockCaptureClientEvent.mock.calls.find(
      ([event]) => event === 'payment_failed'
    );
    expect(failure?.[1]).toEqual(
      expect.objectContaining({ reference: 'cd-popup-matched-1' })
    );
    expect(paymentStartedCalls()[0]?.[1]).toEqual(
      expect.objectContaining({ reference: 'cd-popup-matched-1' })
    );
  } finally {
    fetchMock.mockRestore();
  }
});

it('closes a Credit Direct failure at the canonical order total, not the residual due', async () => {
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credit_direct_enabled: true },
    orderId: 'order-cd-canonical-total',
    // Canonical total above the 5750 residual gateway due.
    orderTotal: 6000,
  });

  try {
    await driveFreshBNPLPlaceOrder(/credit direct/i);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    await act(async () => {
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-canonical-1',
        sessionId: 'signed-session-canonical-1',
      });
    });
    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });
    expect(paymentStartedCalls()[0]?.[1]).toEqual(
      expect.objectContaining({ total: 6000 })
    );

    await act(async () => {
      callArgs?.onError?.('declined');
    });

    await waitFor(() => {
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(true);
    });
    const failure = mockCaptureClientEvent.mock.calls.find(
      ([event]) => event === 'payment_failed'
    );
    expect(failure?.[1]).toEqual(
      expect.objectContaining({ reason: 'credit_direct_error', total: 6000 })
    );
  } finally {
    fetchMock.mockRestore();
  }
});
