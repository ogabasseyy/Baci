import { SavingsInterestActivitySchema } from './savings-interest-activity';

const row = {
  id: 'interest:1',
  goal_id: '9f01153c-1589-4dde-b9aa-8f644a846832',
  amount: 7.33,
  type: 'credit',
  source_type: 'savings_interest',
  description: 'Interest credited',
  created_at: '2026-10-13T08:00:00Z',
};
it('validates goal-linked paid interest and negative reversals', () => {
  expect(SavingsInterestActivitySchema.parse(row).amount).toBe(7.33);
  expect(
    SavingsInterestActivitySchema.parse({
      ...row,
      amount: -7.33,
      type: 'adjustment',
    }).amount
  ).toBe(-7.33);
});
it.each([
  { goal_id: 'wrong' },
  { amount: Number.POSITIVE_INFINITY },
  { source_type: 'wallet_topup' },
  { created_at: 'wrong' },
])('rejects malformed history %p', (override) => {
  expect(
    SavingsInterestActivitySchema.safeParse({ ...row, ...override }).success
  ).toBe(false);
});
