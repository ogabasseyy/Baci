import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { context, id, mocks, request } from './amendment-route.test-support';
import { GET, POST } from './route';

const confirmBody = {
  customerAgreed: true,
  idempotencyKey: 'fixture-confirm-a',
  previewId: id,
  reason: 'Customer requested a replacement',
};

describe('paid order amendment routes', () => {
  it('logs the database code without exposing unexpected RPC messages', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'unexpected_detail' },
    });

    const response = await POST(request(confirmBody), context);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to process order amendment',
    });
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith({
      message: 'Order amendment RPC returned an unexpected error',
      databaseCode: 'P0001',
    });
  });

  it('rate-limits replacement search before querying the catalog', async () => {
    mocks.rateLimit.mockResolvedValueOnce(false);
    const search = new Request(
      `https://test.invalid/api/orders/amendments?lineId=${id}&search=phone`
    ) as NextRequest;
    expect((await GET(search, context)).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('validates and trims replacement search input before querying the catalog', async () => {
    function search(value: string) {
      return new Request(
        `https://test.invalid/api/orders/amendments?lineId=${id}&search=${encodeURIComponent(value)}`
      ) as NextRequest;
    }

    expect((await GET(search(' p '), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await GET(search(' phone '), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_paid_order_amendment_replacements',
      { p_order_id: id, p_line_id: id, p_search: 'phone' }
    );
  });

  it('rate-limits confirmation before dispatching a write', async () => {
    mocks.rateLimit.mockResolvedValueOnce(false);
    expect((await POST(request(confirmBody), context)).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires authentication before querying the order', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('validates CSRF and consent before confirmation', async () => {
    mocks.csrf.mockResolvedValueOnce({ valid: false });
    expect((await POST(request(confirmBody), context)).status).toBe(403);
    expect(
      (await POST(request({ ...confirmBody, customerAgreed: false }), context))
        .status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before calling an RPC', async () => {
    const invalid = new Request('https://test.invalid', {
      body: '{',
      method: 'POST',
    });
    expect((await POST(invalid as NextRequest, context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps a stale preview without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        details: 'private data',
        message: 'preview_stale',
      },
    });
    const response = await POST(request(confirmBody), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'preview_stale',
      error: 'The order changed. Preview the replacement again.',
    });
  });

  it('reports lock contention without invalidating the preview', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '55P03', message: 'could not obtain lock' },
    });
    const response = await POST(request(confirmBody), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 'amendment_busy',
      error: 'This order is busy. Please try again shortly.',
    });
  });
});
