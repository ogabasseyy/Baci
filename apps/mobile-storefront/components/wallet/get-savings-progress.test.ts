import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsProgress } from './get-savings-progress';

const goal = {
  current_amount: 0,
  target_amount: 100000,
} as WalletActiveSavingsGoal;

it('shows progress without claiming an unimplemented saving streak', () => {
  expect(getSavingsProgress(goal)).toEqual({
    milestone: 'Your plan is ready',
    percent: 0,
  });
  expect(getSavingsProgress({ ...goal, current_amount: 50000 })).toEqual({
    milestone: 'Halfway to your device',
    percent: 50,
  });
});

it('clamps invalid targets and overfunding', () => {
  expect(getSavingsProgress({ ...goal, target_amount: 0 }).percent).toBe(0);
  expect(getSavingsProgress({ ...goal, current_amount: 150000 }).percent).toBe(
    100
  );
});

it('does not announce a reached goal before the full target is saved', () => {
  expect(getSavingsProgress({ ...goal, current_amount: 99999 }).percent).toBe(
    99
  );
});
