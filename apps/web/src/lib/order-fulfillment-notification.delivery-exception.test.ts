import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/order-queries', () => ({ ORDER_WITH_ITEMS_QUERY: 'q' }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: vi.fn() }));

import { sendEmail } from '@/lib/zeptomail';
import { sendOrderFulfillmentNotification } from './order-fulfillment-notification';

const merchant = {
  id: 'merchant-1',
  business_name: 'Test Store',
  slug: 'test-store',
  support_email: 'support@test-store.com',
  email_sender_name: null,
  email: 'merchant@test-store.com',
  tax_identification_number: null,
  cac_rc_number: null,
};

const order = (shipping_status: string) => ({
  id: 'order-1',
  customer_id: 'customer-1',
  order_number: 'ORD-001',
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.com',
  customer_phone: '08012345678',
  shipping_status,
  shipping_provider: 'GIGL',
  tracking_number: 'W1',
  tracking_token: 'tok',
  shipping_address: { address: '1 St', city: 'Lagos', state: 'Lagos' },
  order_items: [{ name: 'Parcel', quantity: 1 }],
});

function supabaseFor(
  shippingStatus: string,
  overrides: Record<string, unknown> = {}
) {
  const builderFor = (data: unknown) => {
    const b = {
      eq: vi.fn(() => b),
      select: vi.fn(() => b),
      single: vi.fn().mockResolvedValue({ data, error: null }),
    };
    return b;
  };
  return {
    from: vi.fn((table: string) =>
      table === 'merchants'
        ? builderFor(merchant)
        : builderFor({ ...order(shippingStatus), ...overrides })
    ),
  } as unknown as SupabaseClient;
}

describe('delivery exception emails (GIG failed / returned)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'm' });
  });

  it.each([
    'order_delivery_failed',
    'order_returned',
  ] as const)('sends %s while the order is in flight', async (eventType) => {
    const result = await sendOrderFulfillmentNotification({
      eventType,
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabaseFor('shipped'),
    });
    expect(result).toMatchObject({ status: 'sent' });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it.each([
    'delivered',
    'completed',
    'cancelled',
  ])('bugfix: does not send a failed email unless the order is in flight (%s)', async (status) => {
    const result = await sendOrderFulfillmentNotification({
      eventType: 'order_delivery_failed',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabaseFor(status),
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'order_not_in_required_status',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('bugfix: skips a return queued for a previous shipment after a replacement', async () => {
    const result = await sendOrderFulfillmentNotification({
      eventType: 'order_returned',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabaseFor('shipped'),
      trackingNumber: 'OLD-WAYBILL',
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'order_not_in_required_status',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still sends when the snapshot matches the order tracking number', async () => {
    const result = await sendOrderFulfillmentNotification({
      eventType: 'order_returned',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabaseFor('shipped'),
      trackingNumber: 'w1',
    });
    expect(result).toMatchObject({ status: 'sent' });
  });

  it('bugfix: skips a stale return when the order tracking number was cleared', async () => {
    const supabase = supabaseFor('shipped', { tracking_number: null });
    const result = await sendOrderFulfillmentNotification({
      eventType: 'order_returned',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase,
      trackingNumber: 'OLD-WAYBILL',
    });
    expect(result).toMatchObject({ status: 'skipped' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
