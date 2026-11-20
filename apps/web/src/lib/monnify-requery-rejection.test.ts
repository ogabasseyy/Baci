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
