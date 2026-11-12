import { describe, expect, it } from 'vitest';
import { decideDegradedAlerts } from './degraded-health-decision';

describe('decideDegradedAlerts', () => {
  it('raises nothing when counts are low or unread', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 0, indeterminateTransfers: 2 })
    ).toEqual([]);
    expect(
      decideDegradedAlerts({
        stalledGoalWallets: null,
        indeterminateTransfers: null,
      })
    ).toEqual([]);
  });

  it('raises goal-wallet setup from a single stalled wallet', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 1, indeterminateTransfers: 0 })
    ).toEqual([{ reason: 'goal_wallet_setup_stalled', attempts: 1 }]);
  });

  it('raises transfers at the threshold and both reasons together', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 2, indeterminateTransfers: 3 })
    ).toEqual([
      { reason: 'goal_wallet_setup_stalled', attempts: 2 },
      { reason: 'transfers_indeterminate', attempts: 3 },
    ]);
  });
});
