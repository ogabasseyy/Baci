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
    const invalidBody = await POST(
      request({ action: 'manual', amount: 999 }),
      context
    );
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toEqual({
      error: 'Invalid refund request',
      code: 'invalid_refund_request',
    });
    const invalidId = await GET(request(), {
      params: Promise.resolve({ id: 'invalid' }),
    });
    expect(invalidId.status).toBe(400);
    expect(await invalidId.json()).toEqual({
      error: 'Invalid order ID',
      code: 'invalid_order_id',
    });
  });
  it('reads refund status through the permission-checked RPC', async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('manage_order_refund', {
      p_order_id: id,
      p_action: 'status',
    });
  });
  it('passes the pre-mapped summary error and Paystack signal through', async () => {
    // Both arrive derived at the data layer (direct REST callers
    // bypass this route); the route only normalizes the flag shape.
    const events = [
      {
        id: 'event-1',
        action: 'retry_requested',
        date: '2026-10-01T12:00:00Z',
        details: {
          error:
            'Refund in progress — waiting for the remaining money to arrive.',
          previousError:
            'The refund ran into a problem. Support has the details.',
        },
      },
    ];
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'requires_review',
        error: 'The refund ran into a problem. Support has the details.',
        needsPaystackCheck: true,
        events,
      },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'requires_review',
      error: 'The refund ran into a problem. Support has the details.',
      eventsTruncated: false,
      history: [],
      historyTruncated: false,
      legs: [],
      needsPaystackCheck: true,
      events,
    });
  });
  it('normalizes a missing Paystack signal to false', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'failed',
        error: 'The refund ran into a problem. Support has the details.',
      },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ needsPaystackCheck: false })
    );
  });
  it('passes the pin-candidate legs through to the panel', async () => {
    const legs = [
      {
        amount: 100,
        gateway: 'paystack',
        id: 'leg-1',
        outstanding: 100,
        reference: 'pp-a',
      },
    ];
    mocks.rpc.mockResolvedValue({
      data: { status: 'failed', legs },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ legs }));
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
        p_confirmed: true,
      })
    );
  });
  it('forwards an optional leg pin for manual refunds', async () => {
    const legId = '9ef12000-0000-4000-8000-000000000044';
    const body = {
      action: 'manual',
      amount: 100,
      refundedAt: '2026-09-28T12:00:00Z',
      reference: 'ps-2',
      method: 'paystack',
      confirmed: true,
      paymentTransactionId: legId,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({ p_payment_transaction_id: legId })
    );
    const unpinned = {
      action: 'manual',
      amount: 100,
      refundedAt: '2026-09-28T12:00:00Z',
      reference: 'ps-2',
      method: 'paystack',
      confirmed: true,
    };
    expect((await POST(request(unpinned), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({ p_payment_transaction_id: null })
    );
  });
  it('normalizes empty manual-refund notes to null', async () => {
    const body = {
      action: 'manual',
      amount: 10,
      refundedAt: '2026-09-28T12:00:00Z',
      reference: 'bank-1',
      method: 'bank_transfer',
      note: '',
      confirmed: true,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({ p_note: null })
    );
    const noted = { ...body, note: 'called the bank' };
    expect((await POST(request(noted), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({ p_note: 'called the bank' })
    );
  });
  it.each([
    [''],
    ['   '],
    [undefined],
  ])('stores a blank manual note (%s) as null', async (note) => {
    const body = {
      action: 'manual',
      amount: 50,
      refundedAt: '2026-09-28T12:00:00Z',
      reference: 'bank-1',
      method: 'bank_transfer',
      confirmed: true,
      note,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'manage_order_refund',
      expect.objectContaining({ p_note: null })
    );
  });
});
