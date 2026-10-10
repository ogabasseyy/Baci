import { describe, expect, it } from 'vitest';
import { validateManualRefundInput } from './validate-manual-refund-input';

describe('validateManualRefundInput', () => {
  it('accepts a valid manual input', () => {
    expect(
      validateManualRefundInput({
        amount: '10',
        date: '2026-09-28T12:00',
        remaining: 100,
      })
    ).toBeNull();
  });
  it('rejects non-positive amounts', () => {
    for (const amount of ['', 'abc', '0', '-5'])
      expect(
        validateManualRefundInput({
          amount,
          date: '2026-09-28T12:00',
          remaining: 100,
        })
      ).toContain('greater than zero');
  });
  it('rejects amounts above the remaining balance', () => {
    expect(
      validateManualRefundInput({
        amount: '101',
        date: '2026-09-28T12:00',
        remaining: 100,
      })
    ).toContain('exceeds the remaining balance');
  });
  it('rejects invalid and future dates', () => {
    expect(
      validateManualRefundInput({
        amount: '10',
        date: 'not-a-date',
        remaining: 100,
      })
    ).toContain('valid refund date');
    expect(
      validateManualRefundInput({
        amount: '10',
        date: '2999-01-01T00:00',
        remaining: 100,
      })
    ).toContain('cannot be in the future');
  });
});
