import { describe, expect, it } from 'vitest';
import { decideDegradedAlerts } from './degraded-health-decision';

const counts = (
  indeterminateTransfers: number | null,
  stalledGoalWallets: number | null
) => ({ indeterminateTransfers, stalledGoalWallets });

describe('decideDegradedAlerts', () => {
  it('raises nothing when the counts are low or unread', () => {
    expect(decideDegradedAlerts(counts(2, 2))).toEqual([]);
    expect(decideDegradedAlerts(counts(null, null))).toEqual([]);
  });

  it('raises stuck transfers at the threshold', () => {
    expect(decideDegradedAlerts(counts(3, 0))).toEqual([
      { reason: 'transfers_indeterminate', attempts: 3 },
    ]);
  });

  it('raises stalled goal-wallet setups at the threshold', () => {
    expect(decideDegradedAlerts(counts(0, 3))).toEqual([
      { reason: 'goal_wallet_setup_stalled', attempts: 3 },
    ]);
    expect(decideDegradedAlerts(counts(0, 2))).toEqual([]);
  });

  it('raises both reasons independently, even if one read is unknown', () => {
    expect(decideDegradedAlerts(counts(4, 5))).toEqual([
      { reason: 'transfers_indeterminate', attempts: 4 },
      { reason: 'goal_wallet_setup_stalled', attempts: 5 },
    ]);
    expect(decideDegradedAlerts(counts(null, 3))).toEqual([
      { reason: 'goal_wallet_setup_stalled', attempts: 3 },
    ]);
  });

  it('ignores a count that is not a whole number', () => {
    expect(decideDegradedAlerts(counts(3.5, 3.5))).toEqual([]);
  });
});
