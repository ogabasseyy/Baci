import { mintedCheckoutGenerations } from './minted-checkout-generations';

it('returns the registered generation for inline minting', () => {
  expect(mintedCheckoutGenerations.register('gen-1')).toBe('gen-1');
  expect(mintedCheckoutGenerations.isRegistered('gen-1')).toBe(true);
});

it('reports unregistered generations as not minted', () => {
  expect(mintedCheckoutGenerations.isRegistered('never-registered')).toBe(
    false
  );
});
