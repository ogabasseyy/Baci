import { describe, expect, it } from '@jest/globals';
import { validateBankTransferParams } from './validate-bank-transfer-params';

const legacyParams = {
  accountName: 'Ada Buyer',
  accountNumber: '1234567890',
  amount: '5000',
  bankName: 'Wema Bank',
  orderId: 'order-1',
  orderNumber: 'ORD-1',
  reference: 'ref-1',
};

describe('validateBankTransferParams', () => {
  it('validates legacy params', () => {
    expect(validateBankTransferParams(legacyParams)).toEqual({
      data: expect.objectContaining({ orderId: 'order-1' }),
      error: null,
      isValid: true,
      mode: 'legacy',
    });
  });

  it('prefers the wallet-funded schema when intentId is present', () => {
    const result = validateBankTransferParams({
      ...legacyParams,
      intentId: 'intent-1',
    });

    expect(result.isValid).toBe(true);
    expect(result.mode).toBe('wallet_funded');
  });

  it('rejects wallet-funded params without an intent id', () => {
    const result = validateBankTransferParams({
      ...legacyParams,
      walletFunded: 'true',
    });

    expect(result.isValid).toBe(false);
    expect(result.mode).toBe('wallet_funded');
    expect(result.error).toBeTruthy();
  });

  it('rejects legacy params with missing fields', () => {
    const result = validateBankTransferParams({ orderId: 'order-1' });

    expect(result.isValid).toBe(false);
    expect(result.mode).toBe('legacy');
  });
});
