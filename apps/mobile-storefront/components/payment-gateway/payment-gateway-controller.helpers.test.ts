import { getCloseConfirmationMessage } from './payment-gateway-controller.helpers';

it('retains primary card recovery without claiming an order or a cancelled charge', () => {
  const message = getCloseConfirmationMessage('primary_wallet_card');
  expect(message).toContain('saved');
  expect(message).toContain('Do not pay again');
  expect(message).not.toContain('order');
});
