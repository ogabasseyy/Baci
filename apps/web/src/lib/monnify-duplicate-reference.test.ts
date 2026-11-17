import { describe, expect, it } from 'vitest';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';

describe('isMonnifyDuplicateReferenceText', () => {
  it.each([
    'Duplicate vendReference',
    'Reference has already been used',
    'Reference exists',
    'vendReference in use',
    'Transaction already processed',
    'Request conflict',
    'Conflict on vend reference',
    'transaction_conflict',
    'Insufficient wallet balance; reference is already in use',
    'Idempotency key reused',
  ])('treats "%s" as a duplicate reference', (text) => {
    expect(isMonnifyDuplicateReferenceText(text)).toBe(true);
  });

  it.each([
    'Invalid customer reference',
    'Product does not exist for this biller',
    'Insufficient wallet balance',
    'Amount must be greater than zero',
    'Gateway conflict note: insufficient wallet balance',
    '',
    null,
    undefined,
  ])('does not treat "%s" as a duplicate reference', (text) => {
    expect(isMonnifyDuplicateReferenceText(text)).toBe(false);
  });
});
