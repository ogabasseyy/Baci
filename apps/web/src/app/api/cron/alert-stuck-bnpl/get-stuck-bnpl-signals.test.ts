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

  it.each([
    ['merchant mentions transactionId in plain text', false],
    ['{"paymentTransactionId":"not-klump"}', false],
    ['{"creditDirectClientCompletedAt":"2026-07-03"}', false],
    ['{"klumpTransactionId":"klump-1"}', true],
  ])('accepts only known Klump checkout evidence in %s', (notes, hasCheckoutEvidence) => {
    expect(
      getStuckBnplSignals({ ...order, payment_method: 'klump', notes })
        .hasCheckoutEvidence
    ).toBe(hasCheckoutEvidence);
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

  it('does not page an unconfirmed Klump order with no checkout evidence', () => {
    expect(
      getStuckBnplSignals({ ...order, payment_method: 'klump', notes: null })
        .shouldAlert
    ).toBe(false);
  });

  it.each([
    [' Klump ', true],
    ['CredPal', true],
    [null, false],
    ['unknown_bnpl', false],
  ])('applies the prior evidence policy to %s', (payment_method, shouldAlert) => {
    expect(
      getStuckBnplSignals({
        ...order,
        payment_method,
        notes: JSON.stringify({
          klumpTransactionId: 'klump-1',
          credpalTransactionId: 'credpal-1',
        }),
      }).shouldAlert
    ).toBe(shouldAlert);
  });
});
