import { describe, expect, it, vi } from 'vitest';
import { getAdminOperations } from './admin-operations';

function payload() {
  return {
    financial: {
      paymentSideEffects: [],
      payouts: [],
      reconciliationReview: [],
      settlements: [],
    },
    generatedAt: '2026-08-05T15:02:00.000Z',
    notifications: { email: [], orderOutbox: [], push: [], trackingOutbox: [] },
    shipping: { shipments: [], webhooks: [] },
    summary: {
      notifications: 0,
      paymentSideEffects: 0,
      payouts: 0,
      reconciliationReview: 0,
      settlements: 0,
      shipping: 0,
      workers: 0,
    },
    workers: [],
  };
}

describe('getAdminOperations', () => {
  it('uses the bounded redacted RPC rather than direct cross-merchant table reads', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload(), error: null });

    const result = await getAdminOperations({ rpc } as never, {
      limit: 25,
      offset: 0,
      section: 'all',
    });

    expect(rpc).toHaveBeenCalledWith('get_admin_operations_v2', {
      p_limit: 25,
      p_offset: 0,
      p_section: 'all',
    });
    expect(result.data?.summary.shipping).toBe(0);
    expect(result.error).toBeNull();
  });

  it('fails closed when the response includes a raw provider error field', async () => {
    const invalid = payload();
    invalid.notifications.email.push({
      attemptCount: 1,
      createdAt: '2026-08-05T15:02:00.000Z',
      emailType: 'receipt',
      id: 'email-1',
      merchantId: null,
      merchantName: 'Platform message',
      provider: 'zeptomail',
      providerErrorCode: null,
      providerErrorMessage: 'customer@example.com',
    } as never);
    const rpc = vi.fn().mockResolvedValue({ data: invalid, error: null });

    const result = await getAdminOperations({ rpc } as never, {
      limit: 25,
      offset: 0,
      section: 'notifications',
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('INVALID_OPERATIONS_PAYLOAD');
  });

  it('accepts a processing side effect with a missing claim timestamp as an incident', async () => {
    const data = payload();
    data.financial.paymentSideEffects.push({
      attempts: 1,
      claimedAt: null,
      merchantId: 'merchant-1',
      merchantName: 'Merchant',
      orderId: 'order-1',
      status: 'processing',
      step: 'settlement',
    } as never);
    const rpc = vi.fn().mockResolvedValue({ data, error: null });

    const result = await getAdminOperations({ rpc } as never, {
      limit: 25,
      offset: 0,
      section: 'financial',
    });

    expect(result.error).toBeNull();
    expect(result.data?.financial.paymentSideEffects[0]?.claimedAt).toBeNull();
  });
});
