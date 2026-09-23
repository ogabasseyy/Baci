import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';

const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-push', () => ({ notifyCustomer, notifyMerchant }));

function query(data: unknown) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn(() => builder),
  };
  return builder;
}

function supabaseFor(description: string) {
  const from = vi
    .fn()
    .mockImplementationOnce(() => query({ description }))
    .mockImplementation(() => query(null));
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, rpc };
}

const merchantKinds = [
  ['pickup_delayed', 'Pickup delayed'],
  ['failed', 'Delivery issue'],
  ['returned', 'Order returned'],
  ['cancelled', 'Shipment cancelled'],
] as const;

const customerKinds = [
  ['delivery_attempt_failed', 'Delivery attempt unsuccessful'],
  ['return_in_progress', 'Order being returned'],
] as const;

describe('GIGL tracking notification copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it.each(
    merchantKinds
  )('uses explicit merchant copy for %s', async (kind, title) => {
    const supabase = supabaseFor('provider detail');

    await processClaimedGiglTrackingNotifications(
      supabase as never,
      [
        {
          audience: 'merchant',
          id: '00000000-0000-4000-8000-000000000001',
          merchant_id: '00000000-0000-4000-8000-000000000002',
          notification_kind: kind,
          order_id: '00000000-0000-4000-8000-000000000003',
          shipment_id: '00000000-0000-4000-8000-000000000005',
          tracking_event_id: '00000000-0000-4000-8000-000000000004',
        },
      ],
      'worker'
    );

    expect(notifyMerchant).toHaveBeenCalledWith(
      expect.any(String),
      title,
      expect.not.stringContaining('provider detail'),
      expect.any(Object),
      'orders',
      expect.any(Object)
    );
  });

  it.each(
    customerKinds
  )('uses explicit customer copy for %s', async (kind, title) => {
    const supabase = supabaseFor('provider detail');
    supabase.from
      .mockImplementationOnce(() => query({ customer_id: 'customer' }))
      .mockImplementationOnce(() => query({ user_id: 'user' }));

    await processClaimedGiglTrackingNotifications(
      supabase as never,
      [
        {
          audience: 'customer',
          id: '00000000-0000-4000-8000-000000000001',
          merchant_id: '00000000-0000-4000-8000-000000000002',
          notification_kind: kind,
          order_id: '00000000-0000-4000-8000-000000000003',
          shipment_id: '00000000-0000-4000-8000-000000000005',
          tracking_event_id: '00000000-0000-4000-8000-000000000004',
        },
      ],
      'worker'
    );

    expect(notifyCustomer).toHaveBeenCalledWith(
      'user',
      title,
      expect.not.stringContaining('provider detail'),
      expect.any(Object),
      'orders',
      expect.any(Object)
    );
  });
});
