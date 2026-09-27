import { describe, expect, it } from '@jest/globals';
import { isBnplPayment } from './is-bnpl-payment';

describe('isBnplPayment', () => {
  it('recognizes supported BNPL methods', () => {
    expect(isBnplPayment('credpal')).toBe(true);
    expect(isBnplPayment('credit_direct')).toBe(true);
    expect(isBnplPayment('klump')).toBe(true);
  });

  it('rejects non-BNPL methods', () => {
    expect(isBnplPayment('bank_transfer')).toBe(false);
  });
});
