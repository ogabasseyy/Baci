import { describe, expect, it } from 'vitest';
import { isProviderConfirmedTransaction } from './storefront-account-document-order-projection';

describe('isProviderConfirmedTransaction', () => {
  it.each([
    'completed',
    'success',
    'refunded',
    ' Success ',
  ])('confirms settled value movement (%s)', (status) => {
    expect(
      isProviderConfirmedTransaction({ status, transaction_type: 'payment' })
    ).toBe(true);
  });

  it.each([
    'pending',
    'processing',
    'failed',
    'cancelled',
    '',
    null,
  ])('excludes non-settled rows (%s)', (status) => {
    expect(
      isProviderConfirmedTransaction({ status, transaction_type: 'payment' })
    ).toBe(false);
  });

  it.each([
    'refund',
    'fee',
    null,
    undefined,
  ])('excludes non-payment types (%s) even when completed', (transaction_type) => {
    expect(
      isProviderConfirmedTransaction({
        status: 'completed',
        transaction_type,
      })
    ).toBe(false);
  });
});
