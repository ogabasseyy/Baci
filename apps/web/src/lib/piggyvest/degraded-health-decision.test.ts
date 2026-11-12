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

  it('does not page for one or two stalled goal wallets', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 2, indeterminateTransfers: 0 })
    ).toEqual([]);
  });

  it('raises goal-wallet setup at the same threshold as transfers', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 3, indeterminateTransfers: 0 })
    ).toEqual([{ reason: 'goal_wallet_setup_stalled', attempts: 3 }]);
  });

  it('raises transfers at the threshold and both reasons together', () => {
    expect(
      decideDegradedAlerts({ stalledGoalWallets: 4, indeterminateTransfers: 3 })
    ).toEqual([
      { reason: 'goal_wallet_setup_stalled', attempts: 4 },
      { reason: 'transfers_indeterminate', attempts: 3 },
    ]);
  });
});
