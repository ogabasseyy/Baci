import { describe, expect, it } from 'vitest';
import {
  buildDispatchMerchantSnapshot,
  buildDispatchPaymentSnapshot,
} from './build-manual-order-document-dispatch-snapshot';

const merchant = {
  bank_code: '058',
  bank_account_number: '1234567890',
  bank_name: 'GTBank',
  bank_account_name: 'Shop Ltd',
  business_name: 'Shop Ltd',
  registered_address: null,
  email_sender_name: 'Shop Orders',
  logo_url: 'https://cdn.example.com/logo.png',
} as never;

const ngnInvoice = { currency: 'NGN', total: 100, amount_paid: 0 } as never;

describe('dispatch snapshot builders', () => {
  it('snapshots the VA only when one is selected', () => {
    expect(
      buildDispatchPaymentSnapshot(
        merchant,
        {
          account_number: '9990001111',
          bank_name: 'Paystack-Titan',
          account_name: 'Shop Ltd/ORD',
        },
        ngnInvoice,
        'invoice'
      )
    ).toEqual({
      merchantBankCode: null,
      merchantBankAccountNumber: null,
      merchantBankName: null,
      merchantBankAccountName: null,
      virtualAccountNumber: '9990001111',
      virtualAccountBankName: 'Paystack-Titan',
      virtualAccountName: 'Shop Ltd/ORD',
    });
  });

  it('snapshots the merchant bank fallback when no VA is selected', () => {
    const snapshot = buildDispatchPaymentSnapshot(
      merchant,
      null,
      ngnInvoice,
      'proforma_invoice'
    );
    // bank_code never prints (name/number/account name only): the snapshot
    // reserves the field as null even when the merchant row carries a code.
    expect(snapshot.merchantBankCode).toBeNull();
    expect(snapshot.merchantBankAccountNumber).toBe('1234567890');
    expect(snapshot.virtualAccountNumber).toBeNull();
  });

  it('excludes hidden bank data from the snapshot', () => {
    const va = {
      account_number: '9990001111',
      bank_name: 'Paystack-Titan',
      account_name: 'Shop Ltd/ORD',
    };
    // Foreign currency renders no bank details at all.
    expect(
      buildDispatchPaymentSnapshot(
        merchant,
        va,
        { currency: 'USD', total: 100, amount_paid: 0 },
        'invoice'
      )
    ).toEqual({
      merchantBankCode: null,
      merchantBankAccountNumber: null,
      merchantBankName: null,
      merchantBankAccountName: null,
      virtualAccountNumber: null,
      virtualAccountBankName: null,
      virtualAccountName: null,
    });
    // Receipts render no payment instructions.
    expect(
      buildDispatchPaymentSnapshot(merchant, va, ngnInvoice, 'receipt')
        .virtualAccountNumber
    ).toBeNull();
    // A zero balance renders no instructions even when unpaid.
    expect(
      buildDispatchPaymentSnapshot(
        merchant,
        null,
        { currency: 'NGN', total: 100, amount_paid: 100 },
        'invoice'
      ).merchantBankCode
    ).toBeNull();
  });

  it('snapshots the raw registered address', () => {
    expect(
      buildDispatchMerchantSnapshot(merchant, '12 Marina Street', null)
        .registered_address
    ).toBe('12 Marina Street');
    const legacy = { city: 'Lagos', legacy_note: 'handover' };
    expect(
      buildDispatchMerchantSnapshot(merchant, legacy, null).registered_address
    ).toBe(legacy);
  });

  it('snapshots raw brand colors instead of the normalized shape', () => {
    const legacyColors = { primary: '#111827' };
    const snapshot = buildDispatchMerchantSnapshot(
      merchant,
      '12 Marina Street',
      legacyColors
    );
    expect(snapshot.brand_colors).toBe(legacyColors);
    expect(snapshot.email_sender_name).toBe('Shop Orders');
    expect(snapshot.logo_url).toBe('https://cdn.example.com/logo.png');
  });
});
