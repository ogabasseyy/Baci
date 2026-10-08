import {
  getCloseConfirmationMessage,
  getWalletReturnHref,
} from './payment-gateway-controller.helpers';

it('retains primary card recovery without claiming an order or a cancelled charge', () => {
  const message = getCloseConfirmationMessage('primary_wallet_card');
  expect(message).toContain('saved');
  expect(message).toContain('Do not pay again');
  expect(message).not.toContain('order');
});

it.each([undefined, '', 'https://evil.test/phish', '/wallet?next=/orders'])(
  'falls back to the wallet for %p',
  (returnTo) => {
    expect(getWalletReturnHref(returnTo)).toBe('/wallet');
  }
);

it('preserves a validated in-app savings handoff', () => {
  expect(
    getWalletReturnHref('/wallet?action=savings&savingsGoalId=owned-goal')
  ).toBe('/wallet?action=savings&savingsGoalId=owned-goal');
});
