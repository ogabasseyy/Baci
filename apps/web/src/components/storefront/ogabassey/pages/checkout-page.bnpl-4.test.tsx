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
