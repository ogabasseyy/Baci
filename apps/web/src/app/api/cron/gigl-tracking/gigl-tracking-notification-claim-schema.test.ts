import { describe, expect, it } from 'vitest';
import { claimedGiglTrackingNotificationsSchema } from './gigl-tracking-notification-claim-schema';

const base = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'picked_up',
  order_id: '00000000-0000-4000-8000-000000000003',
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};
const parse = (extra: Record<string, unknown>) =>
  claimedGiglTrackingNotificationsSchema.safeParse([{ ...base, ...extra }]);

describe('claimedGiglTrackingNotificationsSchema recipient_user_ids', () => {
  it('accepts an array of user ids', () => {
    expect(
      parse({ recipient_user_ids: ['00000000-0000-4000-8000-0000000000a1'] })
        .success
    ).toBe(true);
  });

  it('accepts an empty array (nobody qualifies)', () => {
    expect(parse({ recipient_user_ids: [] }).success).toBe(true);
  });

  it('accepts null and omitted values from the pre-migration claim shape', () => {
    expect(parse({ recipient_user_ids: null }).success).toBe(true);
    expect(parse({}).success).toBe(true);
  });

  it('rejects malformed recipient ids', () => {
    expect(parse({ recipient_user_ids: ['not-a-uuid'] }).success).toBe(false);
  });

  it('rejects an unknown audience', () => {
    expect(parse({ audience: 'staff' }).success).toBe(false);
  });
});
