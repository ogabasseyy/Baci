import { describe, expect, it } from 'vitest';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

const open = (answer: unknown, wording: string) =>
  isMonnifyUnresolvedAnswer({ answer, wording });

describe('bugfix: negated duplicate wording and login rejections with an open code', () => {
  it.each([
    'Not a duplicate, vend rejected',
    'No duplicate reference found',
  ])('does not hold on "%s"', (wording) => {
    expect(open({ responseCode: '01' }, wording)).toBe(false);
  });

  it('still holds a real duplicate', () => {
    expect(open({ responseCode: '01' }, 'Duplicate vendReference')).toBe(true);
  });

  it('refunds an authentication rejection even with code 99', () => {
    expect(open({ responseCode: '99' }, 'Invalid access token')).toBe(false);
  });

  it('still holds code 99 without authentication wording', () => {
    expect(open({ responseCode: '99' }, 'Unexpected error')).toBe(true);
  });
});

describe('bugfix: numeric vend-specific status holds', () => {
  it.each([2, '2'])('holds vendStatus %j', (value) => {
    expect(open({ responseBody: { vendStatus: value } }, 'Rejected')).toBe(
      true
    );
  });

  it('does not hold a numeric generic status (an HTTP code)', () => {
    expect(open({ status: 400, responseCode: '01' }, 'Invalid customer')).toBe(
      false
    );
  });
});

describe('bugfix: an unknown vend state is never cleared by a FAILED one', () => {
  it('holds vendStatus FAILED next to transactionStatus UNKNOWN', () => {
    expect(
      open(
        {
          responseBody: { vendStatus: 'FAILED', transactionStatus: 'UNKNOWN' },
        },
        'Rejected'
      )
    ).toBe(true);
  });
});

describe('bugfix: postposed duplicate negation', () => {
  it.each([
    'Duplicate reference not found',
    'Duplicate was not detected',
  ])('does not hold on "%s"', (wording) => {
    expect(open({ responseCode: '01' }, wording)).toBe(false);
  });
});

describe('bugfix: array-valued vend states are read item by item', () => {
  it.each([
    ['UNKNOWN'],
    [2],
    ['PENDING'],
  ])('holds transactionStatus %j', (value) => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { transactionStatus: value } },
        'Rejected'
      )
    ).toBe(true);
  });

  it('does not hold a FAILED array on its own', () => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { vendStatus: ['FAILED'] } },
        'Rejected'
      )
    ).toBe(false);
  });
});

describe('bugfix: any non-generic status key and array flags are read', () => {
  it('holds an unrecognised finalStatus', () => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { finalStatus: 'UNKNOWN' } },
        'Rejected'
      )
    ).toBe(true);
  });

  it('does not treat a generic responseStatus label as a vend state', () => {
    expect(
      open(
        { responseStatus: 'Bad Request', responseCode: '01' },
        'Invalid customer'
      )
    ).toBe(false);
  });

  it('holds an array-valued delivered flag', () => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { delivered: [true] } },
        'Rejected'
      )
    ).toBe(true);
  });
});

describe('bugfix: conflicting vend-level terminal states stay unresolved', () => {
  it('holds vendStatus FAILED beside transactionStatus SUCCESS', () => {
    expect(
      open(
        {
          responseBody: { vendStatus: 'FAILED', transactionStatus: 'SUCCESS' },
        },
        'Rejected'
      )
    ).toBe(true);
  });

  it('holds failed: true beside delivered: true', () => {
    expect(
      open({ responseBody: { failed: true, delivered: true } }, 'Rejected')
    ).toBe(true);
  });
});

describe('bugfix: an unknown generic status holds, an HTTP label does not', () => {
  it("holds status: 'UNKNOWN' inside the body", () => {
    expect(
      open(
        { responseCode: 'D01', responseBody: { status: 'UNKNOWN' } },
        'Rejected'
      )
    ).toBe(true);
  });

  it.each([
    'Bad Request',
    'error',
    '400 Bad Request',
    'Unauthorized',
  ])('does not hold the HTTP label %j', (label) => {
    expect(
      open({ responseCode: '01', status: label }, 'Invalid customer')
    ).toBe(false);
  });
});

describe('bugfix: payment-level flags are subordinate to a vend failure', () => {
  it('does not hold vendStatus FAILED beside paymentSuccessful: true', () => {
    expect(
      open(
        { responseBody: { vendStatus: 'FAILED', paymentSuccessful: true } },
        'Rejected'
      )
    ).toBe(false);
  });

  it('still holds a delivery-level delivered flag', () => {
    expect(open({ responseBody: { delivered: true } }, 'Rejected')).toBe(true);
  });
});
