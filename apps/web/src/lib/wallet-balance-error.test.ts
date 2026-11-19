import { describe, expect, it } from 'vitest';
import { isInsufficientWalletBalanceError } from './wallet-balance-error';

describe('wallet insufficient-balance error contract', () => {
  it.each([
    { message: 'insufficient_wallet_balance' },
    {
      message: 'ERROR: insufficient_wallet_balance\nWHERE: PL/pgSQL function',
      code: 'P0001',
    },
  ])('recognizes the exact or PG-wrapped wallet rejection: %j', (error) => {
    expect(isInsufficientWalletBalanceError(error)).toBe(true);
  });
  it.each([
    null,
    undefined,
    {},
    { code: 'P0001' },
    { message: 'unrelated failure', code: 'P0001' },
    { message: 'ERROR: insufficient_wallet_balance', code: '42501' },
    {
      message: 'mention of insufficient_wallet_balance without a PG error code',
    },
  ])('does not misclassify an unrelated or ambiguous failure: %j', (error) => {
    expect(isInsufficientWalletBalanceError(error)).toBe(false);
  });
});
