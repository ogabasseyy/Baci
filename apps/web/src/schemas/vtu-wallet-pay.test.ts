import { describe, expect, it } from 'vitest';
import { vtuWalletPaySchemas } from './vtu-wallet-pay';

const valid = {
  transactionId: '33333333-3333-4333-8333-333333333333',
  operationId: '11111111-1111-4111-8111-111111111111',
  pin: '1234',
};

describe('vtuWalletPaySchemas.pinRequest', () => {
  it('accepts a purchase, a payment and a 4 to 6 digit PIN', () => {
    expect(vtuWalletPaySchemas.pinRequest.safeParse(valid).success).toBe(true);
    expect(
      vtuWalletPaySchemas.pinRequest.safeParse({ ...valid, pin: '123456' })
        .success
    ).toBe(true);
  });

  it('rejects an amount, a short PIN or a malformed id', () => {
    for (const bad of [
      { ...valid, amountKobo: 1 },
      { ...valid, pin: '123' },
      { ...valid, transactionId: 'x' },
    ])
      expect(vtuWalletPaySchemas.pinRequest.safeParse(bad).success).toBe(false);
  });
});
