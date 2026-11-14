import { describe, expect, it } from 'vitest';
import { readEligibilityReport } from './eligibility-report';

const body = {
  loan_request_reference: 'request-example',
  partner_reference: 'partner-example',
  is_eligible: true,
  status: 'ELIGIBLE',
  message: 'private provider message',
};
const read = (value: unknown, status = 200) =>
  readEligibilityReport(value, status, 'request-example', 'partner-example');

describe('manual eligibility report', () => {
  const completed = {
    ...body,
    status: 'COMPLETED',
    eligible_amount: 400000,
    max_loan_amount: 400000,
    minimum_loan_amount: 10000,
    max_tenure: 12,
  };
  it('recognizes the completed response and preserves naira units without hard-coded limits', () => {
    expect(read(completed)).toMatchObject({
      isEligible: true,
      providerStatus: 'COMPLETED',
      nextStep: 'check_remaining_kyc',
      limits: {
        currency: 'NGN',
        unit: 'naira',
        eligibleAmount: 400000,
        maxLoanAmount: 400000,
        minimumLoanAmount: 10000,
        limitsMatch: true,
      },
      maxTenure: 12,
    });
    expect(
      read({ ...completed, eligible_amount: 250000, max_loan_amount: 250000 })
        ?.limits?.eligibleAmount
    ).toBe(250000);
  });
  it('flags differing limits for reconciliation rather than choosing the higher amount', () => {
    expect(read({ ...completed, max_loan_amount: 1753000 })).toMatchObject({
      nextStep: 'reconcile_status_with_oxygen',
      limits: { limitsMatch: false },
    });
  });
  it.each([
    { ...completed, eligible_amount: '400000' },
    { ...completed, eligible_amount: -1 },
    { ...completed, max_loan_amount: Number.POSITIVE_INFINITY },
    { ...completed, minimum_loan_amount: 500000 },
    { ...completed, minimum_loan_amount: undefined },
    { ...completed, max_tenure: 1.5 },
    { ...completed, max_tenure: 0 },
  ])('rejects malformed completed limits', (value) =>
    expect(read(value)).toBeUndefined());
  it('keeps pending separate from a final decision', () => {
    expect(
      read({ ...body, is_eligible: false, status: 'PENDING' })?.nextStep
    ).toBe('wait_for_review');
    expect(read({ ...completed, status: 'PENDING' })).toBeUndefined();
  });
  it('exposes the observed boolean response without inventing a limit or echoing identity', () => {
    expect(read(body)).toEqual({
      isEligible: true,
      providerStatus: 'ELIGIBLE',
      nextStep: 'confirm_credit_limit_and_remaining_kyc',
    });
  });
  it('does not interpret a false flag as a final decline', () => {
    expect(read({ ...body, is_eligible: false, status: 'PROCESSING' })).toEqual(
      {
        isEligible: false,
        providerStatus: 'PROCESSING',
        nextStep: 'wait_for_review',
      }
    );
  });
  it('redacts unfamiliar status text', () => {
    expect(
      read({ ...body, status: 'private identity or token' })?.providerStatus
    ).toBe('UNRECOGNIZED');
  });
  it.each([
    { ...body, is_eligible: 'true' },
    { ...body, loan_request_reference: 'another-request' },
    { ...body, partner_reference: 'another-partner' },
    { ...body, eligible: false },
    { ...body, error: 'failure' },
    { ...body, status: 'REJECTED' },
    { ...body, is_eligible: false },
    null,
  ])('rejects malformed, mismatched or contradictory responses', (value) => {
    expect(read(value)).toBeUndefined();
  });
  it('ignores this success-shaped response on HTTP errors', () => {
    expect(read(body, 400)).toBeUndefined();
    expect(read(body, 500)).toBeUndefined();
  });
});
