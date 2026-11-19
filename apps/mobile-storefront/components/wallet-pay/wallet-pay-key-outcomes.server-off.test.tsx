import { KEEP_OUTCOMES, PAY_SETTLES } from './wallet-pay-key-outcomes';

describe('wallet pay key outcomes', () => {
  it('keeps the purchase key for answers that prove nothing about a sent payment', () => {
    for (const kind of [
      'pending',
      'review',
      'sign_in',
      'unavailable',
      'not_started',
    ] as const)
      expect(KEEP_OUTCOMES.has(kind)).toBe(true);
  });

  it('settles after a PIN only on a definite answer', () => {
    for (const kind of ['refunded', 'insufficient', 'not_completed'] as const)
      expect(PAY_SETTLES.has(kind)).toBe(true);
    // An IMEI mismatch or refusal may still be confirming: the key stays.
    expect(PAY_SETTLES.has('pending')).toBe(false);
    expect(PAY_SETTLES.has('review')).toBe(false);
  });
});
