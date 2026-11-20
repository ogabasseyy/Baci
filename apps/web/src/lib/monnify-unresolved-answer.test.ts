import { describe, expect, it } from 'vitest';
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

describe('bugfix: structure and flags beat echoed wording', () => {
  it('does not hold a production-shaped FAILED vend whose joined wording says SUCCESS', () => {
    const envelope = {
      requestSuccessful: false,
      responseCode: '01',
      responseBody: { status: 'SUCCESS', vendStatus: 'FAILED' },
    };
    expect(open(envelope, 'Vend rejected SUCCESS FAILED')).toBe(false);
  });

  it('holds a rejection whose body says delivered: true', () => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { delivered: true } },
        'Rejected'
      )
    ).toBe(true);
  });

  it('does not hold a rejection whose body says failed: true', () => {
    expect(
      open({ responseCode: 'D01', responseBody: { failed: true } }, 'Rejected')
    ).toBe(false);
  });

  it('holds a rejection carrying the success code 0', () => {
    expect(open({ responseCode: '0' }, 'Rejected')).toBe(true);
  });
});

describe('bugfix: service-unavailable and unrecognised vend statuses are held', () => {
  it('holds "Service unavailable"', () => {
    expect(open({ responseCode: '01' }, 'Service unavailable')).toBe(true);
  });

  it('holds an unrecognised vend status such as UNKNOWN', () => {
    expect(open({ responseBody: { vendStatus: 'UNKNOWN' } }, 'Rejected')).toBe(
      true
    );
  });

  it('does not hold a generic HTTP status label', () => {
    expect(
      open({ status: 'Bad Request', responseCode: '01' }, 'Invalid customer')
    ).toBe(false);
  });

  it('holds plain-text "Response code is 0"', () => {
    expect(open(null, 'Response code is 0')).toBe(true);
  });
});
