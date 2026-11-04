import { vi } from 'vitest';

export const giglTrackingNotificationTestNotification = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'pickup_en_route',
  order_id: '00000000-0000-4000-8000-000000000003',
  recipient_user_ids: ['00000000-0000-4000-8000-0000000000a1'],
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};

/**
 * Fake notification-worker RPC client. Rows keep the old fixture order:
 * the tracking event, the order, then the customer account.
 */
export function createGiglTrackingNotificationSupabase(...rows: unknown[]) {
  const [event, order, customer] = rows as [
    { description?: string | null } | null | undefined,
    { customer_id?: string | null } | null | undefined,
    { user_id?: string | null } | null | undefined,
  ];
  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === 'gigl_worker_notification_event') {
      return Promise.resolve({
        data: event ? [{ description: event.description ?? null }] : [],
        error: null,
      });
    }
    if (name === 'gigl_worker_notification_customer') {
      return Promise.resolve({
        data: order?.customer_id
          ? [{ customer_user_id: customer?.user_id ?? null }]
          : [],
        error: null,
      });
    }
    return Promise.resolve({ data: true, error: null });
  });
  return { rpc };
}
