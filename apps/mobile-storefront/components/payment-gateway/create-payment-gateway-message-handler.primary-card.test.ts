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
    confirmRedvaultPayment: confirm,
  });
  await sendMessage(handler, { type: 'payment_success' });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(mockCrypto).not.toHaveBeenCalled();
});
