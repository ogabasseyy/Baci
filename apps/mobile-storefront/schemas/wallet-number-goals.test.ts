import { WalletNumberGoalsSchema } from './wallet-number-goals';

const goal = {
  id: 'goal-1',
  current_amount: '100.05',
  target_amount: '1000',
  status: 'active',
};
it('normalizes database numeric strings without losing cents', () => {
  expect(WalletNumberGoalsSchema.parse([goal])).toEqual([
    { ...goal, current_amount: 100.05, target_amount: 1000 },
  ]);
});
it.each([
  '',
  ' ',
  'invalid',
  Number.POSITIVE_INFINITY,
  Number.NaN,
  null,
])('rejects a malformed numeric amount %s', (amount) => {
  expect(
    WalletNumberGoalsSchema.safeParse([{ ...goal, current_amount: amount }])
      .success
  ).toBe(false);
});
it('rejects duplicate goal IDs and non-redeemable statuses', () => {
  expect(WalletNumberGoalsSchema.safeParse([goal, goal]).success).toBe(false);
  expect(
    WalletNumberGoalsSchema.safeParse([{ ...goal, status: 'cancelled' }])
      .success
  ).toBe(false);
});
