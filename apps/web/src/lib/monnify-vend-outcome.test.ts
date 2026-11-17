import { describe, expect, it } from 'vitest';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';

describe('isMonnifyVendOutcomeText', () => {
  it.each([
    'Service unavailable',
    'Vend request failed',
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
    '',
    null,
  ])('does not flag "%s"', (text) => {
    expect(isMonnifyVendOutcomeText(text)).toBe(false);
  });
});
