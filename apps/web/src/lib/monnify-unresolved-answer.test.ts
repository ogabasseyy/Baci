import { describe, expect, it } from 'vitest';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';
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

describe('bugfix: vend-level status beats a generic payment status, both ways', () => {
  it('holds payment FAILED with vendStatus COMPLETED (vend delivered)', () => {
    expect(
      open(
        { responseBody: { status: 'FAILED', vendStatus: 'COMPLETED' } },
        'Rejected'
      )
    ).toBe(true);
  });

  it('does not hold "Validation was successful but vend was rejected"', () => {
    expect(
      open(
        { responseCode: '01' },
        'Validation was successful but vend was rejected'
      )
    ).toBe(false);
  });
});

describe('bugfix: a provider reference alone means a vend may exist', () => {
  const withReference = (responseBody: Record<string, string>) =>
    isMonnifyUnresolvedAnswer({
      answer: { responseCode: 'D01', responseBody },
      requestReference: REQ,
      wording: 'Invalid customer',
    });

  it('holds a rejection whose body carries only a transactionReference', () => {
    expect(withReference({ transactionReference: 'T-1' })).toBe(true);
  });

  it('holds a rejection whose body carries only a Monnify vendReference', () => {
    expect(withReference({ vendReference: 'MFBP-1' })).toBe(true);
  });

  it('holds a different 24-hex reference next to an ordinary refusal', () => {
    expect(withReference({ vendReference: 'ffffffffffffffffffffffff' })).toBe(
      true
    );
  });

  it('does not hold when the body only echoes our own request reference', () => {
    expect(withReference({ transactionReference: REQ })).toBe(false);
  });
});

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
