import {
  isMintedCheckoutGeneration,
  registerMintedCheckoutGeneration,
} from './minted-checkout-generations';

it('returns the registered generation for inline minting', () => {
  expect(registerMintedCheckoutGeneration('gen-1')).toBe('gen-1');
  expect(isMintedCheckoutGeneration('gen-1')).toBe(true);
});

it('reports unregistered generations as not minted', () => {
  expect(isMintedCheckoutGeneration('never-registered')).toBe(false);
});
