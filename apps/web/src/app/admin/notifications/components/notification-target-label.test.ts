import { describe, expect, it } from 'vitest';
import { getNotificationTargetLabel } from './notification-target-label';

const notification = {
  target_merchant_ids: [] as string[],
  target_segment: null,
  target_type: 'all' as const,
};

describe('getNotificationTargetLabel', () => {
  it('uses a non-count label when specific recipient IDs are redacted', () => {
    expect(
      getNotificationTargetLabel({
        ...notification,
        target_type: 'specific',
      })
    ).toBe('Specific merchants');
  });

  it('reports the scoped recipient count and segment label', () => {
    expect(
      getNotificationTargetLabel({
        ...notification,
        target_merchant_ids: ['merchant-1', 'merchant-2'],
        target_type: 'specific',
      })
    ).toBe('2 Merchants');
    expect(
      getNotificationTargetLabel({
        ...notification,
        target_segment: 'at_risk',
        target_type: 'segment',
      })
    ).toBe('Segment: at_risk');
  });
});
