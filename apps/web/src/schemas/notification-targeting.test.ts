import { describe, expect, it } from 'vitest';
import { notificationTargetingSchema } from './notification-targeting';

describe('notificationTargetingSchema', () => {
  it('rejects duplicate specific merchant targets', () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';

    expect(
      notificationTargetingSchema.safeParse({
        target_merchant_ids: [merchantId, merchantId],
        target_type: 'specific',
      }).success
    ).toBe(false);
  });
});
