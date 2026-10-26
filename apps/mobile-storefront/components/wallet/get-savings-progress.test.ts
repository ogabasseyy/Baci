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
    percentLabel: '0%',
  });
  expect(getSavingsProgress({ ...goal, current_amount: 50000 })).toEqual({
    milestone: 'Halfway to your device',
    percent: 50,
    percentLabel: '50%',
  });
});

describe('bugfix: positive savings below one percent', () => {
  it.each([
    [0, 0, '0%'],
    [100, 0.04, '<1%'],
    [2000, 0.8, '<1%'],
    [2500, 1, '1%'],
    [249000, 99.6, '99%'],
    [250000, 100, '100%'],
    [300000, 100, '100%'],
  ])('formats %s saved without rounding away numeric progress', (amount, percent, label) => {
    const result = getSavingsProgress({
      ...goal,
      current_amount: amount,
      target_amount: 250000,
    });

    expect(result.percent).toBeCloseTo(percent);
    expect(result).toHaveProperty('percentLabel', label);
  });
});

it('clamps invalid targets and overfunding', () => {
  expect(getSavingsProgress({ ...goal, target_amount: 0 }).percent).toBe(0);
  expect(getSavingsProgress({ ...goal, current_amount: 150000 }).percent).toBe(
    100
  );
});
