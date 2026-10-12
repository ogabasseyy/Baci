import { describe, expect, it } from 'vitest';
import { isUserFacingCheckoutError } from './vtu-checkout-error-classifier';

describe('isUserFacingCheckoutError', () => {
  it.each([
    'Biller name or provider key is required for bill payment',
    'Customer account not found for this storefront',
    'Failed to initiate purchase',
    'Invalid customer phone number',
    'Invalid phone number',
    'Merchant not found',
    'Monnify validation reference is required but missing',
    'VTU is not enabled for this merchant',
    'Electricity purchases are not enabled',
    'Amount for EKEDC must be exactly 1000',
    'Data bundle amount changed since validation',
    'Data bundle not found for code XYZ',
    'Invalid network provider: Foo',
    'Maximum amount for betting is 50000',
    'Minimum amount for airtime is 100',
    'Monnify airtime biller not found for MTN',
    'Monnify airtime product not found for 13',
    'Monnify product not found for IKEDC',
    'Monnify validation failed: bad meter',
    'Multiple data bundles match mtn-1gb',
  ])('passes through %s', (message) => {
    expect(isUserFacingCheckoutError(message)).toBe(true);
  });

  it.each([
    'Failed to look up idempotency key: relation "vtu_idempotency_keys" does not exist',
    'https://xyz.supabase.co/rest/v1/merchants?slug=eq.foo 500',
    'duplicate key value violates unique constraint "vtu_idempotency_keys_pkey"',
    'Unexpected error',
    '',
  ])('blocks %s', (message) => {
    expect(isUserFacingCheckoutError(message)).toBe(false);
  });
});
