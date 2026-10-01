import { mockResumeFetch } from './checkout-page-bnpl.test-support';
import {
  act,
  CheckoutPage,
  expect,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  openCreditDirectCheckout,
  openCredPalCheckout,
  render,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('records the resumed CredPal start only after the widget loads, and closes it on error', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = mockResumeFetch('NGN');

  try {
    render(<CheckoutPage />);
    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    const config = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    expect(config).toBeDefined();
    const startedCalls = () =>
      mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
        ([event]) => event === 'payment_started'
      );

    // The opener resolved but the widget never loaded: no start yet.
    expect(startedCalls()).toHaveLength(0);

    // Pre-load setup error: toast only, no funnel failure.
    act(() => {
      config?.onError?.({ success: false, message: 'setup failed' });
    });
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_failed',
      expect.anything(),
      expect.anything()
    );

    // Load proves the provider flow opened: the start is recorded.
    act(() => {
      config?.onLoad?.();
    });
    await waitFor(() => {
      expect(startedCalls()).toHaveLength(1);
    });
    expect(startedCalls()[0]?.[1]).toMatch(/^ord-1:/);
    expect(startedCalls()[0]?.[2]).toEqual(
      expect.objectContaining({
        payment_method: 'credpal',
        currency: 'NGN',
        total: 5750,
      })
    );

    // Post-load error closes the recorded start.
    act(() => {
      config?.onError?.({ success: false, message: 'declined' });
    });
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        expect.stringMatching(/^ord-1:/),
        expect.objectContaining({
          payment_method: 'credpal',
          reason: 'credpal_error',
        })
      );
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('closes a resumed Credit Direct start when the provider errors after popup', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credit_direct',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = mockResumeFetch('NGN');

  try {
    render(<CheckoutPage />);
    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    const config = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    expect(config).toBeDefined();
    const startedCalls = () =>
      mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
        ([event]) => event === 'payment_started'
      );

    // Init failure swallowed into onError before any popup: toast only.
    act(() => {
      config?.onError?.('init failed');
    });
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_failed',
      expect.anything(),
      expect.anything()
    );

    // Popup proves the provider flow opened: the start is recorded.
    await act(async () => {
      await config?.onPopup?.({
        checkoutTransactionId: 'cd-tx-1',
        sessionId: 'cd-sess-1',
      });
    });
    await waitFor(() => {
      expect(startedCalls()).toHaveLength(1);
    });
    expect(startedCalls()[0]?.[2]).toEqual(
      expect.objectContaining({ payment_method: 'credit_direct' })
    );

    // Post-popup error closes the recorded start.
    act(() => {
      config?.onError?.('declined');
    });
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        expect.stringMatching(/^ord-1:/),
        expect.objectContaining({
          payment_method: 'credit_direct',
          reason: 'credit_direct_error',
        })
      );
    });
  } finally {
    fetchMock.mockRestore();
  }
});
