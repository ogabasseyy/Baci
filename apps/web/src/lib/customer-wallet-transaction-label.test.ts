import { describe, expect, it } from 'vitest';
import { customerWalletTransactionLabel } from './customer-wallet-transaction-label';

const id = '3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';

describe('customerWalletTransactionLabel', () => {
  it('labels an IMEI store-credit payment without the provider or lookup id', () => {
    expect(
      customerWalletTransactionLabel({
        description: `Petrock IMEI lookup payment: ${id}`,
        sourceType: 'imei_wallet_payment',
      })
    ).toBe('IMEI check');
  });

  it('labels an IMEI refund without the provider', () => {
    expect(
      customerWalletTransactionLabel({
        description:
          'Petrock IMEI submission did not start - payment refunded to wallet',
        sourceType: 'imei_wallet_refund',
      })
    ).toBe('IMEI check refund');
  });

  it('strips a provider from an unmapped description (old rows, other kinds)', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Partial invoice payment via paystack',
        sourceType: 'invoice_payment',
      })
    ).toBe('Partial invoice payment');
    expect(
      customerWalletTransactionLabel({
        description: `Petrock IMEI wallet payment: ${id}`,
        sourceType: null,
      })
    ).toBe('IMEI wallet payment');
  });

  it('keeps networks and billers the customer chose', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Refund for failed Airtime MTN purchase ₦100',
        sourceType: 'vtu_transaction_refund',
      })
    ).toBe('Refund for failed Airtime MTN purchase ₦100');
  });

  it('falls back to "Transaction" when nothing customer-facing is left', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Petrock',
        sourceType: null,
      })
    ).toBe('Transaction');
    expect(customerWalletTransactionLabel({ description: null })).toBe(
      'Transaction'
    );
  });
});
