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
