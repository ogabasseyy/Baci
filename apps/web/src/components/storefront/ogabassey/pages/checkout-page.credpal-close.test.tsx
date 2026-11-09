import { renderFreshBNPLCheckout } from './checkout-page-bnpl.test-support';
import {
  continueToPaymentAfterPickupCheck,
  expect,
  fireEvent,
  it,
  openCredPalCheckout,
  renderCheckoutWithStoreRates,
  screen,
} from './checkout-page-test-support';

it('does not offer or open retired CredPal when its stored flag is enabled', async () => {
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true, credit_direct_enabled: true },
    orderId: 'order-retired-credpal',
  });
  try {
    renderCheckoutWithStoreRates();
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    await continueToPaymentAfterPickupCheck();
    fireEvent.click(
      await screen.findByRole('button', { name: /pay small small/i })
    );
    expect(
      screen.queryByRole('radio', { name: /credpal/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /credit direct/i })
    ).toBeInTheDocument();
    expect(openCredPalCheckout).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/orders',
      expect.anything()
    );
  } finally {
    fetchMock.mockRestore();
  }
});
