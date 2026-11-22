import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as action } from './[amendmentId]/actions/route';
import { POST as preview } from './preview/route';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rateLimit: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/rate-limiter', () => ({ checkRateLimit: mocks.rateLimit }));

const id = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id }) };
const confirmBody = {
  customerAgreed: true,
  idempotencyKey: 'fixture-confirm-a',
  previewId: id,
  reason: 'Customer requested a replacement',
};

function request(body?: unknown) {
  return new Request('https://test.invalid/api/orders/amendments', {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: body === undefined ? 'GET' : 'POST',
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id } });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { amendmentId: id }, error: null });
});

describe('paid order amendment routes', () => {
  it('rate-limits replacement search before querying the catalog', async () => {
    mocks.rateLimit.mockResolvedValueOnce(false);
    const search = new Request(
      `https://test.invalid/api/orders/amendments?lineId=${id}&search=phone`
    ) as NextRequest;
    expect((await GET(search, context)).status).toBe(429);
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

  it('sends replacement identity and tenant-scoped order ID to preview', async () => {
    const body = { lineId: id, replacement: { id, kind: 'variant' } };
    expect((await preview(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('preview_paid_order_amendment', {
      p_order_id: id,
      p_payload: body,
    });
  });

  it('accepts only a verified evidence ID and uses the authenticated order action RPC', async () => {
    const actionContext = { params: Promise.resolve({ id, amendmentId: id }) };
    const topUp = {
      action: 'record_top_up',
      evidenceId: id,
      idempotencyKey: 'fixture-top-up',
    };
    expect(
      (await action(request({ ...topUp, amountMinor: 5000 }), actionContext))
        .status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await action(request(topUp), actionContext)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('run_paid_order_amendment_action', {
      p_order_id: id,
      p_amendment_id: id,
      p_payload: topUp,
    });
  });

  it('does not invoke a settlement command when CSRF fails', async () => {
    mocks.csrf.mockResolvedValueOnce({ valid: false });
    const actionContext = { params: Promise.resolve({ id, amendmentId: id }) };
    expect(
      (
        await action(
          request({
            action: 'reverse',
            reason: 'Synthetic',
            idempotencyKey: 'fixture-reverse',
          }),
          actionContext
        )
      ).status
    ).toBe(403);
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
