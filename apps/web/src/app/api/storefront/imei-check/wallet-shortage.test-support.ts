import { expect } from 'vitest';

export function expectImeiWalletShortage(
  body: unknown,
  expected: { balance: number; required: number }
) {
  expect(body).toMatchObject({
    ...expected,
    code: 'WALLET_INSUFFICIENT',
  });
}
