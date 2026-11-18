import { describe, expect, it } from 'vitest';
import { getStuckBnplSignals } from './get-stuck-bnpl-signals';

const order = {
  payment_method: 'credit_direct',
  payment_status: 'bnpl_pending',
  notes: '{"creditDirectSessionId":"session-a"}',
};

describe('getStuckBnplSignals', () => {
  it('keeps an opened session as review evidence without a push', () => {
    expect(getStuckBnplSignals(order)).toMatchObject({
      hasCheckoutEvidence: true,
      hasConfirmation: false,
      shouldAlert: false,
    });
    expect(
      getStuckBnplSignals({ ...order, notes: null }).hasCheckoutEvidence
    ).toBe(false);
  });

  it('accepts provider approval or a matching completed session', () => {
    expect(
      getStuckBnplSignals({ ...order, payment_status: 'bnpl_approved' })
        .hasConfirmation
    ).toBe(true);
    expect(
      getStuckBnplSignals({
        ...order,
        notes: JSON.stringify({
          creditDirectSessionId: 'session-a',
          creditDirectClientCompletedSessionId: 'session-a',
          creditDirectClientCompletedAt: '2026-07-03',
        }),
      }).hasConfirmation
    ).toBe(true);
  });

  it('ignores completion of the previous session', () => {
    expect(
      getStuckBnplSignals({
        ...order,
        notes: JSON.stringify({
          creditDirectSessionId: 'session-b',
          creditDirectClientCompletedSessionId: 'session-a',
          creditDirectClientCompletedAt: '2026-07-03',
        }),
      }).hasConfirmation
    ).toBe(false);
  });

  it.each([
    [' Klump ', true],
    ['CredPal', true],
    [null, false],
    ['unknown_bnpl', false],
  ])('applies the prior evidence policy to %s', (payment_method, shouldAlert) => {
    expect(getStuckBnplSignals({ ...order, payment_method }).shouldAlert).toBe(
      shouldAlert
    );
  });
});
