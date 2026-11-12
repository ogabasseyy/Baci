import { describe, expect, it } from 'vitest';
import { decideDegradedAlerts } from './degraded-health-decision';

describe('decideDegradedAlerts', () => {
  it('raises nothing when the count is low or unread', () => {
    expect(decideDegradedAlerts({ indeterminateTransfers: 2 })).toEqual([]);
    expect(decideDegradedAlerts({ indeterminateTransfers: null })).toEqual([]);
  });

  it('raises stuck transfers at the threshold', () => {
    expect(decideDegradedAlerts({ indeterminateTransfers: 3 })).toEqual([
      { reason: 'transfers_indeterminate', attempts: 3 },
    ]);
  });

  it('ignores a count that is not a whole number', () => {
    expect(decideDegradedAlerts({ indeterminateTransfers: 3.5 })).toEqual([]);
  });
});
