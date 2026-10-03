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

describe('dispatch snapshot builders', () => {
  it('maps bank fields and the preferred virtual account', () => {
    expect(
      buildDispatchPaymentSnapshot(merchant, {
        account_number: '9990001111',
        bank_name: 'Paystack-Titan',
        account_name: 'Shop Ltd/ORD',
      })
    ).toEqual({
      merchantBankCode: '058',
      merchantBankAccountNumber: '1234567890',
      merchantBankName: 'GTBank',
      merchantBankAccountName: 'Shop Ltd',
      virtualAccountNumber: '9990001111',
      virtualAccountBankName: 'Paystack-Titan',
      virtualAccountName: 'Shop Ltd/ORD',
    });
    expect(
      buildDispatchPaymentSnapshot(merchant, null).virtualAccountNumber
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
