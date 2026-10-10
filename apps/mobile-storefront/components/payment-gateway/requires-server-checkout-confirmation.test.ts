import { expect, it } from '@jest/globals';
import { requiresServerCheckoutConfirmation } from './requires-server-checkout-confirmation';

it('routes primary and existing verified UBA callbacks to server confirmation, not generic crypto success', () => {
  expect(
    requiresServerCheckoutConfirmation(undefined, 'primary_wallet_card')
  ).toBe(true);
  expect(requiresServerCheckoutConfirmation('uba_redvault', 'order')).toBe(
    true
  );
  expect(requiresServerCheckoutConfirmation(undefined, 'wallet')).toBe(false);
});
