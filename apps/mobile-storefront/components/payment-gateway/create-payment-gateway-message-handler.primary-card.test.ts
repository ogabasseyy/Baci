import { expect, it, jest } from '@jest/globals';

const mockCrypto = jest.fn();
jest.mock('./payment-gateway-crypto-success', () => ({
  handleCryptoSuccessMessage: mockCrypto,
}));
const { createHandler, sendMessage } =
  require('./create-payment-gateway-message-handler.test-utils') as typeof import('./create-payment-gateway-message-handler.test-utils');

it('never falls through primary checkout messages to generic credit/order success without a server confirmer', async () => {
  const { handler, clearCart, setSuccessStatus } = createHandler({
    paymentKind: 'primary_wallet_card',
  });
  await sendMessage(handler, { type: 'crypto_success' });
  expect(mockCrypto).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
  expect(setSuccessStatus).not.toHaveBeenCalled();
});
it('uses the existing hosted callback boundary to request authoritative primary status only', async () => {
  mockCrypto.mockClear();
  const confirm = jest.fn();
  const { handler } = createHandler({
    paymentKind: 'primary_wallet_card',
    confirmServerPayment: confirm,
  });
  await sendMessage(handler, { type: 'payment_success' });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(mockCrypto).not.toHaveBeenCalled();
});
it('ignores raw success messages when no server confirmer is wired', async () => {
  mockCrypto.mockClear();
  // Defense in depth alongside the production-wiring case: even if a
  // primary handler were created without the server-checkout confirmer,
  // raw WebView success claims credit nothing and clear nothing.
  const { handler, clearCart, setSuccessStatus } = createHandler({
    paymentKind: 'primary_wallet_card',
  });
  await sendMessage(handler, { type: 'payment_success' });
  await sendMessage(handler, { type: 'success' });
  expect(mockCrypto).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
  expect(setSuccessStatus).not.toHaveBeenCalled();
});
it('routes raw success messages through server confirmation only under production wiring', async () => {
  mockCrypto.mockClear();
  const confirm = jest.fn();
  // Production wiring: use-payment-gateway-controller always provides the
  // server-checkout confirmer for primary_wallet_card, so raw WebView
  // claims must reach only that confirmer — never the blind-credit
  // crypto path or a direct success side effect.
  const { handler, clearCart, setSuccessStatus } = createHandler({
    paymentKind: 'primary_wallet_card',
    confirmServerPayment: confirm,
  });
  await sendMessage(handler, { type: 'crypto_success' });
  await sendMessage(handler, { type: 'success' });
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(mockCrypto).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
  expect(setSuccessStatus).not.toHaveBeenCalled();
});
