import {
  driveFreshBNPLPlaceOrder,
  renderFreshBNPLCheckout,
} from './checkout-page-bnpl.test-support';
import {
  act,
  expect,
  it,
  openCredPalCheckout,
  screen,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('re-enables Place Order after a CredPal popup close so the shopper can retry', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-close',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);
    await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalledOnce());

    const firstAttempt = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    expect(firstAttempt?.onClose).toBeTypeOf('function');
    await act(async () => {
      firstAttempt?.onClose?.();
    });

    const retryButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(retryButton).toBeDefined();
    await act(async () => {
      retryButton?.click();
    });

    await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalledTimes(2));
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});
