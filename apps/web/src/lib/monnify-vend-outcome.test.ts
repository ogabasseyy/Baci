import { describe, expect, it } from 'vitest';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';

describe('isMonnifyVendOutcomeText', () => {
  it.each([
    'Service unavailable',
    'Vend request failed',
    'Vend transaction failed: insufficient wallet balance',
    'Vend request has failed',
    'Transaction failed: insufficient wallet balance',
    'Airtime purchase failed: insufficient wallet balance',
    'Payment has failed',
    'Top-up failed',
    'Vend transaction was unsuccessful: insufficient wallet balance',
    'Failed to vend airtime',
    'Airtime delivered',
    'Request processed',
    'Transaction completed',
    'Vend successful',
  ])('flags "%s" as a vend outcome', (text) => {
    expect(isMonnifyVendOutcomeText(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'Amount must be greater than zero',
    'Unauthorized',
    'Access denied',
    'Request could not be processed',
    'Airtime not delivered',
    "Couldn't be completed",
    'Cannot be processed',
    'Has never been vended',
    '',
    null,
  ])('does not flag "%s"', (text) => {
    expect(isMonnifyVendOutcomeText(text)).toBe(false);
  });
});
