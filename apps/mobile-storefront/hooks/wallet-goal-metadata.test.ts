import { walletGoalMetadata } from './wallet-goal-metadata';

it('ignores only the balance and timestamps when comparing savings plan metadata', () => {
  const goal = {
    id: 'plan',
    title: 'Phone',
    target_amount: 1000,
    current_amount: 100,
  };
  expect(walletGoalMetadata(goal)).toBe(
    walletGoalMetadata({ ...goal, current_amount: 200, updated_at: 'now' })
  );
  expect(walletGoalMetadata(goal)).not.toBe(
    walletGoalMetadata({ ...goal, product_id: 'different' })
  );
  expect(walletGoalMetadata(goal)).not.toBe(
    walletGoalMetadata({ ...goal, status: 'paused' })
  );
  expect(walletGoalMetadata(goal)).not.toBe(
    walletGoalMetadata({ ...goal, product_snapshot: { storage: '128GB' } })
  );
});
it.each([
  null,
  1,
  {},
  { id: 1 },
])('rejects a row without a valid plan identity: %s', (row) => {
  expect(walletGoalMetadata(row)).toBeNull();
});
