import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnonClient = {
  rpc: vi.fn(),
};

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => mockAnonClient),
}));

import { createAnonClient } from '@/lib/supabase/anon';
import { GET } from './route';

function makeTrackedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-123',
    order_number: 'ORD-241204-A7K3-2',
    shipping_status: 'pending',
    payment_status: 'paid',
    subtotal: 10000,
    shipping_cost: 1000,
    discount_amount: 0,
    total: 11000,
    currency: 'NGN',
    created_at: '2026-03-23T10:00:00Z',
    updated_at: '2026-03-23T10:00:00Z',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    customer_phone: '+2348012345678',
    shipping_address: {
      address: '123 Example Street',
      city: 'Lagos',
      state: 'Lagos',
    },
    tracking_number: null,
    shipping_provider: null,
    merchant_business_name: 'Test Store',
    merchant_logo_url: null,
    merchant_support_email: 'support@test-store.com',
    merchant_support_phone: null,
    merchant_phone: '+2348000000000',
    items: [],
    ...overrides,
  };
}

describe('GET /api/storefront/orders/track-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnonClient).mockReturnValue(mockAnonClient as never);
  });

  it('returns 400 for invalid email lookup input', async () => {
    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?order_number=ORD-001&email=invalid&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockAnonClient.rpc).not.toHaveBeenCalled();
  });

  it('tries legacy order-number candidates until a match is found', async () => {
    mockAnonClient.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [makeTrackedOrder({ order_number: '#00001234' })],
        error: null,
      });

    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?order_number=00001234&email=jane@example.com&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.order.order_number).toBe('#00001234');
    expect(mockAnonClient.rpc).toHaveBeenCalledTimes(2);
    expect(mockAnonClient.rpc).toHaveBeenNthCalledWith(
      1,
      'get_order_tracking',
      {
        p_merchant_slug: 'test-store',
        p_order_id: null,
        p_order_number: '00001234',
        p_email: 'jane@example.com',
        p_tracking_token: null,
      }
    );
    expect(mockAnonClient.rpc).toHaveBeenNthCalledWith(
      2,
      'get_order_tracking',
      {
        p_merchant_slug: 'test-store',
        p_order_id: null,
        p_order_number: '#00001234',
        p_email: 'jane@example.com',
        p_tracking_token: null,
      }
    );
  });

  it('uses token lookup without trying order-number fallbacks', async () => {
    mockAnonClient.rpc.mockResolvedValue({
      data: [makeTrackedOrder()],
      error: null,
    });

    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?token=track-token-123&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.order.order_number).toBe('ORD-241204-A7K3-2');
    expect(mockAnonClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockAnonClient.rpc).toHaveBeenCalledWith('get_order_tracking', {
      p_merchant_slug: 'test-store',
      p_order_id: null,
      p_order_number: null,
      p_email: null,
      p_tracking_token: 'track-token-123',
    });
  });

  it('exposes tax and gift-wrapping components for settlement attribution', async () => {
    mockAnonClient.rpc.mockResolvedValue({
      data: [makeTrackedOrder({ tax_amount: 750, gift_wrapping_fee: 250 })],
      error: null,
    });

    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?token=track-token-123&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.order.tax_amount).toBe(750);
    expect(data.order.gift_wrapping_fee).toBe(250);
  });

  it('normalizes a legacy canceled row to cancelled with no delivery estimate', async () => {
    mockAnonClient.rpc.mockResolvedValue({
      data: [makeTrackedOrder({ shipping_status: 'canceled' })],
      error: null,
    });

    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?token=track-token-123&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.order.status).toBe('cancelled');
    expect(data.estimated_delivery).toBeNull();
  });

  it('keeps the customer timeline free of processing when the raw status is processing', async () => {
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        makeTrackedOrder({
          shipping_status: 'processing',
          payment_status: 'paid',
        }),
      ],
      error: null,
    });

    const request = new NextRequest(
      'https://example.com/api/storefront/orders/track-order?token=track-token-123&merchant_slug=test-store'
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      data.timeline.map((event: { title: string }) => event.title)
    ).toEqual(['Order Placed', 'Payment Confirmed', 'On the way']);
    expect(
      data.timeline.some(
        (event: { title: string }) => event.title === 'Processing'
      )
    ).toBe(false);
  });
});
