import { describe, expect, it } from 'vitest';
import { validateManualRefundInput } from './validate-manual-refund-input';

const valid = {
  amount: '10',
  confirmed: true,
  date: '2026-09-28T12:00',
  method: 'bank_transfer',
  reference: 'bank-1',
  remaining: 100,
};

describe('validateManualRefundInput', () => {
  it('accepts a valid manual input', () => {
    expect(validateManualRefundInput(valid)).toBeNull();
  });
  it('rejects non-positive amounts', () => {
    for (const amount of ['', 'abc', '0', '-5'])
      expect(validateManualRefundInput({ ...valid, amount })).toContain(
        'greater than zero'
      );
  });
  it('rejects amounts with more than two decimals', () => {
    expect(validateManualRefundInput({ ...valid, amount: '10.291' })).toContain(
      'at most two decimals'
    );
    expect(validateManualRefundInput({ ...valid, amount: '10.29' })).toBeNull();
  });
  it('rejects amounts above the remaining balance', () => {
    expect(validateManualRefundInput({ ...valid, amount: '101' })).toContain(
      'exceeds the remaining balance'
    );
  });
  it('rejects invalid and future dates', () => {
    expect(
      validateManualRefundInput({ ...valid, date: 'not-a-date' })
    ).toContain('valid refund date');
    expect(
      validateManualRefundInput({ ...valid, date: '2999-01-01T00:00' })
    ).toContain('cannot be in the future');
  });
  it('rejects blank or overlong references', () => {
    expect(validateManualRefundInput({ ...valid, reference: '   ' })).toContain(
      'transfer reference'
    );
    expect(
      validateManualRefundInput({ ...valid, reference: ` ${'p'.repeat(101)} ` })
    ).toContain('100 characters or fewer');
  });
  it('rejects unknown methods and missing confirmation', () => {
    expect(validateManualRefundInput({ ...valid, method: 'crypto' })).toContain(
      'how the money moved'
    );
    expect(validateManualRefundInput({ ...valid, confirmed: false })).toContain(
      'Confirm that the money already moved'
    );
  });
  it('requires a capture choice only for ambiguous Paystack records', () => {
    expect(
      validateManualRefundInput({
        ...valid,
        method: 'paystack',
        requirePaymentLeg: true,
      })
    ).toContain('Select which Paystack capture');
    expect(
      validateManualRefundInput({
        ...valid,
        method: 'paystack',
        paymentLegId: 'leg-1',
        requirePaymentLeg: true,
      })
    ).toBeNull();
    expect(
      validateManualRefundInput({ ...valid, method: 'paystack' })
    ).toBeNull();
  });
});
