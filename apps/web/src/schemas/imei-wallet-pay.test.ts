import { describe, expect, it } from 'vitest';
import { imeiCheckSchema } from './imei-check';
import { imeiWalletPaySchemas } from './imei-wallet-pay';

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';

describe('imeiCheckSchema paymentMethod', () => {
  it('defaults to store credit so existing clients are unchanged', () => {
    const parsed = imeiCheckSchema.parse({ imei: '356938035643809' });
    expect(parsed.paymentMethod).toBe('store_credit');
  });

  it('accepts the PiggyVest wallet and refuses anything else', () => {
    expect(
      imeiCheckSchema.parse({
        imei: '356938035643809',
        paymentMethod: 'piggyvest_wallet',
      }).paymentMethod
    ).toBe('piggyvest_wallet');
    expect(
      imeiCheckSchema.safeParse({
        imei: '356938035643809',
        paymentMethod: 'card',
      }).success
    ).toBe(false);
  });
});

describe('imeiWalletPaySchemas', () => {
  it('takes a PIN for an operation, never an amount', () => {
    expect(
      imeiWalletPaySchemas.pinRequest.safeParse({
        operationId: OP,
        pin: '1234',
      }).success
    ).toBe(true);
    expect(
      imeiWalletPaySchemas.pinRequest.safeParse({
        operationId: OP,
        pin: '1234',
        amountKobo: 1,
      }).success
    ).toBe(false);
    expect(
      imeiWalletPaySchemas.pinRequest.safeParse({
        operationId: OP,
        pin: '12a4',
      }).success
    ).toBe(false);
  });

  it('pays with an optional proof (empty on a status re-check) and the IMEI', () => {
    expect(
      imeiWalletPaySchemas.payRequest.parse({
        operationId: OP,
        pinProof: 'a'.repeat(64),
        imei: '356938035643809',
      })
    ).toMatchObject({ operationId: OP });
    expect(
      imeiWalletPaySchemas.payRequest.parse({
        operationId: OP,
        imei: '356938035643809',
      }).pinProof
    ).toBe('');
    expect(
      imeiWalletPaySchemas.payRequest.safeParse({
        operationId: OP,
        pinProof: 'short',
        imei: '356938035643809',
      }).success
    ).toBe(false);
  });
});
