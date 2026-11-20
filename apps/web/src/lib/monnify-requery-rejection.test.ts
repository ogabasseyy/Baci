import { describe, expect, it } from 'vitest';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';

const check = (rawMessage: string, envelope: unknown = {}) =>
  isMonnifyRequeryRejectionDefiniteFailure({ envelope, rawMessage });

describe('isMonnifyRequeryRejectionDefiniteFailure', () => {
  it('accepts explicit vend-failed wording', () => {
    expect(check('Vend failed (D02)')).toBe(true);
  });

  it.each([
    'Transaction not found',
    'Invalid vend reference',
    'Transaction failed unexpectedly, please re-query (99)',
    'Request failed, vend pending',
    'Something went wrong',
    '',
  ])('does not accept "%s"', (message) => {
    expect(check(message)).toBe(false);
  });

  it('does not accept failure wording when the body shows a running vend', () => {
    expect(
      check('Vend failed', { responseBody: { vendStatus: 'PENDING' } })
    ).toBe(false);
  });
});

describe('bugfix: generic query failures do not prove the vend failed', () => {
  it.each([
    'Request failed',
    'Status lookup failed',
    'Authentication failed',
    'Requery failed',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });

  it.each([
    'Transaction failed',
    'Airtime purchase failed',
    'Vend unsuccessful',
    'Vend reversed',
  ])('accepts "%s"', (message) => {
    expect(check(message)).toBe(true);
  });
});

describe('bugfix: query-level refusals never prove the vend failed', () => {
  it.each([
    'Authentication declined',
    'Request declined',
    'Requery rejected',
    'Access denied',
    'Token reversed',
    'Status lookup unsuccessful',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });

  it.each([
    'Vend declined',
    'Transaction reversed',
    'Purchase cancelled',
  ])('still accepts "%s"', (message) => {
    expect(check(message)).toBe(true);
  });
});

describe('bugfix: a FAILED vend status proves failure even when the message does not', () => {
  it('accepts vendStatus FAILED with a neutral message', () => {
    expect(
      check('Request could not be completed', {
        responseBody: { vendStatus: 'FAILED' },
      })
    ).toBe(true);
  });

  it('does not accept FAILED while another status is still pending', () => {
    expect(
      check('Rejected', {
        responseBody: { status: 'FAILED', vendStatus: 'PENDING' },
      })
    ).toBe(false);
  });

  it.each([
    'Status lookup unsuccessful',
    'Authentication unsuccessful',
    'Request declined',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

describe('bugfix: a bare failure word with no vend noun is not proof', () => {
  it.each([
    'Declined',
    'Reversed',
    'Unsuccessful',
    'Cancelled',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

describe('bugfix: a negated failure is not proof the vend failed', () => {
  it.each([
    'Transaction has not failed',
    'Vend was not unsuccessful',
    'Purchase did not fail',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

describe('bugfix: vend-level FAILED, generic status and terminal synonyms', () => {
  it('accepts a vend FAILED even when the message says "Request failed"', () => {
    expect(
      check('Request failed', { responseBody: { vendStatus: 'FAILED' } })
    ).toBe(true);
  });

  it('does not accept a generic top-level status FAILED with a neutral message', () => {
    expect(check('Could not complete', { status: 'FAILED' })).toBe(false);
  });

  it('does not accept FAILED next to an unknown vend state', () => {
    expect(
      check('Rejected', {
        responseBody: { vendStatus: 'FAILED', transactionStatus: 'UNKNOWN' },
      })
    ).toBe(false);
  });

  it.each([
    'Vend rejected',
    'Transaction refused',
    'Purchase denied',
  ])('accepts "%s"', (message) => {
    expect(check(message)).toBe(true);
  });

  it('keeps "Request rejected" unresolved', () => {
    expect(check('Request rejected')).toBe(false);
  });
});

describe('bugfix: negated rejection synonyms are not proof of failure', () => {
  it.each([
    'Vend was not rejected',
    'Transaction was never refused',
    'Payment was not denied',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

describe('bugfix: ancillary-operation failures do not prove the vend failed', () => {
  it.each([
    'Transaction reversal failed',
    'Transaction refund failed',
    'Payment settlement failed',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

describe('bugfix: a failure that is not confirmed is not proof', () => {
  it.each([
    'Transaction failure was not confirmed',
    'Vend failed, but this was not confirmed',
    'Purchase failed (unconfirmed)',
    'Vend failed and cannot be confirmed',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });

  it('still accepts a plainly confirmed vend failure', () => {
    expect(check('Vend failed')).toBe(true);
  });
});
