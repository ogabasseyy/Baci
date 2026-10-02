import { describe, expect, it } from 'vitest';
import { isProviderConfirmedTransaction } from './storefront-account-document-bundle';

describe('isProviderConfirmedTransaction', () => {
  it.each([
    'completed',
    'success',
    'refunded',
    ' Success ',
  ])('confirms settled value movement (%s)', (status) => {
    expect(isProviderConfirmedTransaction({ status })).toBe(true);
  });

  it.each([
    'pending',
    'processing',
    'failed',
    'cancelled',
    '',
    null,
  ])('excludes non-settled rows (%s)', (status) => {
    expect(isProviderConfirmedTransaction({ status })).toBe(false);
  });
});
