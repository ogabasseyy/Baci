import { vi } from 'vitest';

export const giglTrackingNotificationTestNotification = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'pickup_en_route',
  order_id: '00000000-0000-4000-8000-000000000003',
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};

export function createGiglTrackingNotificationQuery(
  data: unknown,
  selections: string[] = []
) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn((columns: string) => {
      selections.push(columns);
      return builder;
    }),
  };
  return builder;
}

export function createGiglTrackingNotificationSupabase(...rows: unknown[]) {
  const selections: string[] = [];
  const from = vi
    .fn()
    .mockImplementation(() =>
      createGiglTrackingNotificationQuery(rows.shift() ?? null, selections)
    );
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, rpc, selections };
}
