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

  it('labels a wallet top-up even with no description', () => {
    expect(
      customerWalletTransactionLabel({
        description: null,
        sourceType: 'wallet_topup',
      })
    ).toBe('Wallet top-up');
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

  it('labels PiggyVest wallet funding rows without the provider name', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'PiggyVest bank transfer',
        sourceType: 'piggyvest_primary_inflow',
      })
    ).toBe('Money added');
    expect(
      customerWalletTransactionLabel({
        description: 'PiggyVest card funding',
        sourceType: 'piggyvest_primary_card_custody',
      })
    ).toBe('Card top-up');
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

  it('strips truncated ids, long hex or digit tokens and an IMEI on the generic path', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Petrock IMEI wallet payment: 3f2b…',
        sourceType: null,
      })
    ).toBe('IMEI wallet payment');
    expect(
      customerWalletTransactionLabel({
        description: 'Check for 356938035643809 ref a1b2c3d4e5f6',
        sourceType: null,
      })
    ).toBe('Check for ref a1b2c3d4e5f6');
  });

  it('strips known stack providers wherever they appear', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Refund from Kuda for bill payment',
        sourceType: null,
      })
    ).toBe('Refund for bill payment');
    expect(
      customerWalletTransactionLabel({
        description: 'Delivery fee Shiip',
        sourceType: null,
      })
    ).toBe('Delivery fee');
  });

  it("keeps the customer's own phone number on an airtime row", () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Airtime MTN 08031234567 via vtpass',
        sourceType: null,
      })
    ).toBe('Airtime MTN 08031234567');
  });

  it('keeps a payment method or actor after via/by/through', () => {
    for (const description of [
      'Payment by card',
      'Refund by merchant',
      'Wallet top-up via transfer',
      'Paid through wallet',
    ]) {
      expect(
        customerWalletTransactionLabel({ description, sourceType: null })
      ).toBe(description);
    }
  });

  it('keeps a network or biller after via, and an international phone number', () => {
    for (const description of [
      'Airtime purchase via MTN',
      'Electricity via IKEDC',
      'Airtime MTN 2348031234567',
    ]) {
      expect(
        customerWalletTransactionLabel({ description, sourceType: null })
      ).toBe(description);
    }
  });

  it('keeps a 20-digit electricity token', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Electricity token 12345678901234567890',
        sourceType: null,
      })
    ).toBe('Electricity token 12345678901234567890');
  });

  it('leaves no stray dash or punctuation after removing a provider', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Payment — Paystack',
        sourceType: null,
      })
    ).toBe('Payment');
    expect(
      customerWalletTransactionLabel({
        description: 'Payment via Paystack.',
        sourceType: null,
      })
    ).toBe('Payment');
  });

  it('strips PiggyVest from an unmapped row as a backstop', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'PiggyVest bank transfer',
        sourceType: null,
      })
    ).toBe('Bank transfer');
  });

  it('keeps an amount and a multi-word "via" phrase', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Wallet top-up via bank transfer ₦5000',
        sourceType: null,
      })
    ).toBe('Wallet top-up via bank transfer ₦5000');
  });

  it('keeps ordinary words that only use hex letters', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Money added… to a faded deed',
        sourceType: null,
      })
    ).toBe('Money added… to a faded deed');
  });

  it('never re-punctuates a description that had nothing to hide', () => {
    expect(
      customerWalletTransactionLabel({
        description: 'Airtime - MTN 0800',
        sourceType: 'vtu_transaction',
      })
    ).toBe('Airtime - MTN 0800');
    expect(
      customerWalletTransactionLabel({
        description: 'cashback on order',
        sourceType: 'cashback',
      })
    ).toBe('cashback on order');
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

  it.each([
    'constructor',
    'toString',
    '__proto__',
  ])('never resolves an inherited name (%s) as a fixed label', (sourceType) => {
    expect(
      customerWalletTransactionLabel({
        description: 'Wallet payment via Kuda',
        sourceType,
      })
    ).toBe('Wallet payment');
  });
});
