import { describe, expect, it } from 'vitest';
import { isConsistentGoalCancelSplit } from './goal-cancel-split-consistency';

describe('isConsistentGoalCancelSplit', () => {
  it('accepts a principal plus interest that equals the balance', () => {
    expect(
      isConsistentGoalCancelSplit(
        { principalKobo: 250000, forfeitedInterestKobo: 12000 },
        262000
      )
    ).toBe(true);
  });

  it.each([
    [{ principalKobo: 0, forfeitedInterestKobo: 262000 }],
    [{ principalKobo: 250000, forfeitedInterestKobo: 1 }],
    [{ principalKobo: 262001, forfeitedInterestKobo: -1 }],
    [{ principalKobo: 250000.5, forfeitedInterestKobo: 11999.5 }],
    [{ principalKobo: Number.NaN, forfeitedInterestKobo: 0 }],
  ])('refuses %j', (split) => {
    expect(isConsistentGoalCancelSplit(split, 262000)).toBe(false);
  });
});
