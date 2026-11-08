import { describe, expect, it } from 'vitest';
import { workerHostReplayScope } from './webhook-capture-drain-scope';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

describe('workerHostReplayScope', () => {
  it.each<[PiggyvestWebhookKeyFamily[], string | null, string | null]>([
    [['legacy'], 'bank-transfer.inflow.success', 'LEGACY_FAMILY'],
    [['legacy'], 'interest-accrued.success', 'LEGACY_FAMILY'],
    [['legacy'], null, 'LEGACY_FAMILY'],
    [['bank', 'legacy'], 'interest-payout.success', 'LEGACY_FAMILY'],
    [['bank', 'legacy'], 'bank-transfer.inflow.success', null],
    [['bank'], 'bank-transfer.inflow.success', null],
    [['custody'], 'wallet-transfer.outflow.success', null],
    [['interest'], 'interest-payout.success', null],
    // Not the owner, but not legacy either: the drain still judges it.
    [['interest'], 'bank-transfer.inflow.success', null],
    [['interest'], 'interest-accrued.success', null],
  ])('scopes families %j with event %s as %s', (families, eventType, scope) => {
    expect(
      workerHostReplayScope({ key_families: families, event_type: eventType })
    ).toBe(scope);
  });

  it('flags legacy rows as LEGACY_FAMILY by default and admits them only when enabled', () => {
    const row = {
      key_families: ['legacy'] as PiggyvestWebhookKeyFamily[],
      event_type: 'bank-transfer.inflow.success',
    };
    expect(workerHostReplayScope(row)).toBe('LEGACY_FAMILY');
    expect(workerHostReplayScope(row, true)).toBeNull();
  });
});
