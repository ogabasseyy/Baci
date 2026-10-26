import { walletGoalMetadata } from '../hooks/wallet-goal-metadata';
import { WalletNumberGoalsSchema } from './wallet-number-goals';

const goal = {
  id: 'goal-1',
  current_amount: '100.05',
  target_amount: '1000',
  product_id: 'product-1',
  variant_id: null,
  title: 'Phone',
  product_snapshot: {},
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  source_mode: 'manual',
  status: 'active',
  maturity_date: '2026-11-01',
  metadata: '',
};
goal.metadata = walletGoalMetadata(goal) ?? '';
it('normalizes database numeric strings without losing cents', () => {
  expect(WalletNumberGoalsSchema.parse([goal])).toEqual([
    {
      ...goal,
      current_amount: 100.05,
      target_amount: 1000,
      contribution_amount: 100,
      metadata: goal.metadata,
    },
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

it('rejects missing product snapshot metadata instead of treating it as unchanged', () => {
  const { product_snapshot: _snapshot, ...incomplete } = goal;
  expect(WalletNumberGoalsSchema.safeParse([incomplete]).success).toBe(false);
});
