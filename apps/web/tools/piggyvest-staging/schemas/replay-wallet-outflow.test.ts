import { expect, it } from 'vitest';
import { replayWalletOutflowSchema } from './replay-wallet-outflow';

const value = {
  reference: 'ref',
  amount: 100,
  currency: 'NGN',
  source_wallet_id: 'source',
  destination_wallet_id: 'destination',
  transaction_id: 'transaction',
};
it('requires full wallet identities and transaction ID, not just a successful event name', () => {
  expect(replayWalletOutflowSchema.safeParse(value).success).toBe(true);
  expect(
    replayWalletOutflowSchema.safeParse({ ...value, transaction_id: undefined })
      .success
  ).toBe(false);
});
it.each([
  { status: 'pending' },
  { amount: 0.1 },
  { amount: 0 },
  { currency: 'USD' },
  { source_wallet_id: '' },
])('refuses inconsistent evidence %s', (override) => {
  expect(
    replayWalletOutflowSchema.safeParse({ ...value, ...override }).success
  ).toBe(false);
});
