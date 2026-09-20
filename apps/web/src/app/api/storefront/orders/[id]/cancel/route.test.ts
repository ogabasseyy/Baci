import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckRateLimit = vi.fn();
const mockSendOrderCancellationEmail = vi.fn();
const mockRpc = vi.fn();
const mockCreateAnonClient = vi.fn();
const mockCreateServiceClient = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  createRateLimitResponse: (
    limit: number,
    remaining: number,
    resetTime: number
  ) =>
    new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(resetTime),
      },
    }),
}));

vi.mock('@/lib/order-cancellation-email', () => ({
  sendOrderCancellationEmail: (...args: unknown[]) =>
    mockSendOrderCancellationEmail(...args),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: (...args: unknown[]) => mockCreateAnonClient(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: (...args: unknown[]) => mockCreateServiceClient(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from './route';

const ORDER_ID = '00000000-0000-4000-8000-000000000abc';
const TRACKING_TOKEN = 'tracking-token-abc';

function makeRequest(body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/storefront/orders/${ORDER_ID}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

const params = Promise.resolve({ id: ORDER_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60_000,
  });
  mockCreateAnonClient.mockReturnValue({ rpc: mockRpc });
  mockCreateServiceClient.mockReturnValue({ rpc: vi.fn() });
  mockSendOrderCancellationEmail.mockResolvedValue({ success: true });
});

describe('POST /api/storefront/orders/[id]/cancel', () => {
  it('returns 429 when the IP rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });

    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params,
    });

    expect(res.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid order id', async () => {
    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the tracking token is missing', async () => {
    const res = await POST(makeRequest({ reason: 'changed my mind' }), {
      params,
    });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('cancels through the token-gated RPC and emails best-effort', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const res = await POST(
      makeRequest({ tracking_token: TRACKING_TOKEN, reason: 'changed lanes' }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, cancelled: true });
    expect(mockRpc).toHaveBeenCalledWith('cancel_storefront_order_as_guest', {
      p_order_id: ORDER_ID,
      p_tracking_token: TRACKING_TOKEN,
      p_reason: 'changed lanes',
    });
    expect(mockSendOrderCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, cancelledBy: 'customer' })
    );
  });

  it('reports an idempotent no-op without emailing', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, cancelled: false });
    expect(mockSendOrderCancellationEmail).not.toHaveBeenCalled();
  });

  it('returns 404 when the token does not match', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'order_not_found', code: 'P0002' },
    });

    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params,
    });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the order is no longer cancellable', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'redvault_guest_cancel_active', code: 'P0001' },
    });

    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(
      expect.objectContaining({ code: 'order_not_cancellable' })
    );
  });

  it('returns 500 on unexpected RPC failures', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: 'XX000' },
    });

    const res = await POST(makeRequest({ tracking_token: TRACKING_TOKEN }), {
      params,
    });

    expect(res.status).toBe(500);
  });
});
