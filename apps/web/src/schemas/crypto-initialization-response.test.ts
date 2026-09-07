import { describe, expect, it } from 'vitest';
import { cryptoInitializationResponseSchema } from './crypto-initialization-response';

describe('crypto initialization response', () => {
  it('accepts a gateway response', () => {
    expect(
      cryptoInitializationResponseSchema.safeParse({
        success: true,
        reference: 'ref',
        crypto_payment: {
          address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          chain: 'TRX',
          currency: 'USDT',
          amount: 100,
          crypto_amount: '0.10',
          confirmation_time: '1 minute',
        },
      }).success
    ).toBe(true);
  });
  it('rejects a missing wallet address', () => {
    expect(
      cryptoInitializationResponseSchema.safeParse({
        success: true,
        reference: 'ref',
        crypto_payment: {},
      }).success
    ).toBe(false);
  });
});

const completeResponse = {
  success: true,
  reference: 'ref',
  crypto_payment: {
    address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    chain: 'TRX',
    currency: 'USDT',
    amount: 322500,
    crypto_amount: '4.44',
    confirmation_time: '1-3 minutes',
  },
};

describe('crypto response variants', () => {
  it.each([
    { chain: 'TRX', address: '0x1234567890123456789012345678901234567890' },
    { chain: 'ETH', address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' },
  ])('rejects invalid $chain wallet addresses', ({ chain, address }) => {
    const response = {
      ...completeResponse,
      crypto_payment: { ...completeResponse.crypto_payment, chain, address },
    };
    const result = cryptoInitializationResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
  it('rejects bank-account success without crypto payment instructions', () => {
    const response = {
      success: true,
      reference: 'ref',
      bank_account: { account_number: '1234567890' },
    };
    const result = cryptoInitializationResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
  it('accepts the server pending response with an empty address', () => {
    const response = {
      ...completeResponse,
      crypto_address_pending: true,
      crypto_payment: { ...completeResponse.crypto_payment, address: '' },
    };
    const result = cryptoInitializationResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
  it.each([
    false,
    undefined,
  ])('rejects an empty address without pending=true (%s)', (pending) => {
    const response = {
      ...completeResponse,
      crypto_address_pending: pending,
      crypto_payment: { ...completeResponse.crypto_payment, address: '' },
    };
    const result = cryptoInitializationResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
  it('requires crypto payment details even while the address is pending', () => {
    const result = cryptoInitializationResponseSchema.safeParse({
      success: true,
      reference: 'ref',
      crypto_address_pending: true,
    });
    expect(result.success).toBe(false);
  });
});
