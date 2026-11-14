import { MISMATCH_ERROR, SAME_PIN_ERROR } from './wallet-pin-errors';

it('keeps the PIN refusal messages plain and distinct', () => {
  expect(MISMATCH_ERROR).toBe('The two PINs do not match.');
  expect(SAME_PIN_ERROR).toBe('Choose a different PIN from your current one.');
});
