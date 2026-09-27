import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('./restamp-merchant-rate', () => ({
  restampMerchantRateOnReuse: vi.fn(),
}));

import { cookies } from 'next/headers';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import { restampMerchantRateOnReuse } from './restamp-merchant-rate';

describe('POST /api/orders/reuse', () => {
  const mockRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({} as never);
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      rpc: mockRpc,
    } as never);
  });

  it('reopens a reusable pending order', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'tracking-token-123',
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
        shipping_provider: 'GIGL',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      order: {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'tracking-token-123',
      },
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'prepare_storefront_order_for_checkout',
      expect.objectContaining({
        p_payment_method: 'card',
      })
    );
  });

  it('re-stamps a merchant-rate reuse when a shipping_rate_id is forwarded', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'tracking-token-123',
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
        shipping_rate_id: '123e4567-e89b-12d3-a456-426614174777',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(restampMerchantRateOnReuse).toHaveBeenCalledWith({
      orderId: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
      merchantId: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
      shippingRateId: '123e4567-e89b-12d3-a456-426614174777',
    });
  });

  it('does not re-stamp a normal reuse without a shipping_rate_id', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'tracking-token-123',
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
        shipping_provider: 'GIGL',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(restampMerchantRateOnReuse).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid input', async () => {
    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: 'not-a-uuid',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Invalid request data',
      code: 'validation_error',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when csrf validation fails', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'Invalid CSRF token' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps already-paid orders to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'order_already_paid' },
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: 'Order is no longer reusable' });
  });

  it('returns 409 when the reuse RPC rejects an approved BNPL order', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'order_not_reusable', code: 'P0001' },
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'credit_direct',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: 'Order is no longer reusable' });
  });

  it('maps empty RPC results to 404 instead of 500', async () => {
    mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Order not found' });
  });

  it('maps unexpected RPC failures to reusable-order conflict instead of 500', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'new row for relation "orders" violates check constraint "orders_payment_status_check"',
        code: '23514',
      },
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: 'Order is no longer reusable' });
  });

  it('returns a JSON 500 response when the reuse RPC throws', async () => {
    mockRpc.mockRejectedValue(new Error('database unavailable'));

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to prepare reusable order',
      code: 'reuse_order_failed',
    });
  });

  it('maps serialized_inventory_unavailable to 409 with proper code and message', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'serialized_inventory_unavailable',
        code: '55000',
      },
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: 'Some items in your order are out of stock',
      code: 'serialized_inventory_unavailable',
    });
  });
});
