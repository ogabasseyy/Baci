import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { GET, POST } from './route';

const id = '7343de92-de96-4a0f-a3c0-2344aeb5b008';
const context = { params: Promise.resolve({ id }) };
function request(body?: unknown) {
  return new NextRequest(`https://example.com/api/orders/${id}/refund`, {
    method: body ? 'POST' : 'GET',
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });
}
describe('order refund route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: 'owner' },
      supabase: { rpc: mocks.rpc },
      error: null,
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.rpc.mockResolvedValue({ data: { status: 'failed' }, error: null });
  });
  it('requires authentication before reading or mutating', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await GET(request(), context)).status).toBe(401);
    expect((await POST(request({ action: 'retry' }), context)).status).toBe(
      401
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires CSRF protection for changes', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(request({ action: 'retry' }), context)).status).toBe(
      403
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid bodies and identifiers', async () => {
    expect(
      (await POST(request({ action: 'manual', amount: 999 }), context)).status
    ).toBe(400);
    expect(
      (await GET(request(), { params: Promise.resolve({ id: 'invalid' }) }))
        .status
    ).toBe(400);
  });
  it('reads refund status through the permission-checked RPC', async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('manage_order_refund', {
      p_order_id: id,
      p_action: 'status',
    });
  });
  it('queues retries without invoking a payment provider', async () => {
    expect((await POST(request({ action: 'retry' }), context)).status).toBe(
      200
    );
    expect(mocks.rpc).toHaveBeenCalledWith('manage_order_refund', {
      p_order_id: id,
      p_action: 'retry',
    });
  });
  it('records confirmed manual refunds with their audit details', async () => {
    const body = {
      action: 'manual',
      amount: 27574.83,
      refundedAt: '2026-09-28T12:00:00Z',
      reference: 'bank-1',
      method: 'bank_transfer',
      confirmed: true,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({
        p_amount: 27574.83,
        p_reference: 'bank-1',
        p_method: 'bank_transfer',
      })
    );
  });
  it.each([
    [
      '42501',
      403,
      'refund_forbidden',
      'You do not have permission to manage this refund',
    ],
    ['28000', 401, 'not_authenticated', 'Authentication required'],
    ['P0002', 404, 'order_not_found', 'Order not found'],
    [
      'P0001',
      409,
      'refund_processing_or_requires_review',
      'Refund is processing or requires review',
    ],
    ['P0001', 409, 'internal_detail', 'Unable to manage refund'],
    ['unexpected', 500, 'internal_detail', 'Unable to manage refund'],
  ])('maps database %s errors to %s without echoing raw text', async (code, status, message, expectedError) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code, message },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: expectedError, code });
  });
});
