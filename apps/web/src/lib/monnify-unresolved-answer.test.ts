import { describe, expect, it } from 'vitest';
import { readMonnifyRejectionVendReference } from './monnify-rejection-vend-reference';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

const open = (answer: unknown, wording: string) =>
  isMonnifyUnresolvedAnswer({ answer, wording });

describe('isMonnifyUnresolvedAnswer', () => {
  it.each([
    ['code 99', { responseCode: '99' }, 'Unexpected error, re-query'],
    ['code 408', { responseCode: '408' }, 'Gateway slow'],
    ['code 502', { responseCode: '502' }, 'Bad gateway'],
    ['pending wording', {}, 'Vend pending'],
    ['in-progress wording', {}, 'Vend in progress'],
    ['timed out wording', {}, 'Request timed out'],
    [
      'PENDING status',
      { responseBody: { vendStatus: 'PENDING' } },
      'Could not complete',
    ],
    ['duplicate wording', {}, 'Duplicate vendReference'],
    ['duplicate flag', { duplicate: true }, 'Rejected'],
  ])('holds %s', (_l, answer, wording) => {
    expect(open(answer, wording)).toBe(true);
  });

  it.each([
    ['plain refusal', { responseCode: '01' }, 'Invalid customer reference'],
    ['login rejection code 401', { responseCode: '401' }, 'Token expired'],
    ['throttle code 429', { responseCode: '429' }, 'Slow down'],
    ['a negated outcome', {}, 'Transaction could not be processed'],
  ])('does not hold %s', (_l, answer, wording) => {
    expect(open(answer, wording)).toBe(false);
  });

  it('lets a known low-float refusal win over a bare open code', () => {
    expect(open({ responseCode: '500' }, 'Insufficient wallet balance')).toBe(
      false
    );
  });

  it('still holds a known refusal that also reports a PENDING vend', () => {
    expect(
      open(
        { responseBody: { vendStatus: 'PENDING' } },
        'Insufficient wallet balance'
      )
    ).toBe(true);
  });
});

describe('readMonnifyRejectionVendReference', () => {
  const ref = 'a1b2c3d4e5f6a1b2c3d4e5f6';
  it("returns Monnify's own vendReference", () => {
    expect(
      readMonnifyRejectionVendReference(
        { responseBody: { vendReference: ' MFBP-9 ' } },
        ref
      )
    ).toBe('MFBP-9');
  });
  it('ignores an echo of our own request reference', () => {
    expect(
      readMonnifyRejectionVendReference(
        { responseBody: { vendReference: ref.toUpperCase() } },
        ref
      )
    ).toBeUndefined();
  });
  it.each([
    null,
    'x',
    [],
    { responseBody: null },
    { responseBody: {} },
  ])('returns nothing for %j', (answer) => {
    expect(readMonnifyRejectionVendReference(answer, ref)).toBeUndefined();
  });
});

describe('isMonnifyRequeryRejectionDefiniteFailure', () => {
  const f = (rawMessage: string, envelope: unknown = {}) =>
    isMonnifyRequeryRejectionDefiniteFailure({ envelope, rawMessage });

  it('accepts explicit vend-failed wording', () => {
    expect(f('Vend failed (D02)')).toBe(true);
  });
  it.each([
    'Transaction not found',
    'Invalid vend reference',
    'Transaction failed unexpectedly, please re-query (99)',
    'Request failed, vend pending',
    'Something went wrong',
  ])('does not accept %s', (m) => {
    expect(f(m)).toBe(false);
  });
});

describe('bugfix: an explicit FAILED vend status is not masked by a payment-level success', () => {
  it('does not hold a body with payment status SUCCESS and vendStatus FAILED', () => {
    expect(
      open(
        { responseBody: { status: 'SUCCESS', vendStatus: 'FAILED' } },
        'Vend rejected'
      )
    ).toBe(false);
  });

  it('still holds when a vend is PENDING next to a FAILED payment status', () => {
    expect(
      open(
        { responseBody: { status: 'FAILED', vendStatus: 'PENDING' } },
        'Vend rejected'
      )
    ).toBe(true);
  });
});
