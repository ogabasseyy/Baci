import { WALLET_PIN_ERRORS } from './wallet-pin-errors';

it('keeps the PIN refusal messages plain and distinct', () => {
  expect(WALLET_PIN_ERRORS.mismatch).toBe('The two PINs do not match.');
  expect(WALLET_PIN_ERRORS.samePin).toBe(
    'Choose a different PIN from your current one.'
  );
});
