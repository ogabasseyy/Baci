import { describe, expect, it, vi } from 'vitest';
import {
  loadPaidOrderDocument,
  loadTrackingAmendment,
} from './paid-order-amendment-document';

const orderId = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const amendment = {
  state: 'settled',
  holdFulfillment: false,
  balanceDueMinor: 0,
  refundOwedMinor: 0,
  documentId: revision,
  documentNumber: 2,
};
const order = { total: 480, subtotal: 480, amount_paid: 480 };
const items = [{ name: 'Replacement', price: 480 }];

describe('loadPaidOrderDocument', () => {
  it('loads the requested immutable revision and strips non-document fields', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        amendment,
        documentNumber: 2,
        inputs: { order: { ...order, internal_note: 'private' }, items },
      },
      error: null,
    });

    await expect(
      loadPaidOrderDocument({ rpc }, orderId, revision)
    ).resolves.toEqual({
      data: { amendment, documentNumber: 2, inputs: { order, items } },
      error: null,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'read_paid_order_amendment_document',
      { p_order_id: orderId, p_version: revision }
    );
  });

  it.each([
    { ...order, total: '480' },
    { ...order, amount_paid: null },
    { total: 480 },
  ])('rejects incomplete or malformed amended money (%j)', async (header) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { amendment, documentNumber: 2, inputs: { order: header, items } },
      error: null,
    });
    await expect(
      loadPaidOrderDocument({ rpc }, orderId, 'original')
    ).resolves.toEqual({
      data: null,
      error: 'invalid',
    });
  });

  it.each([
    ['P0002', 'not_found'],
    ['PGRST202', 'unavailable'],
  ])('maps RPC error %s to %s', async (code, error) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
    await expect(
      loadPaidOrderDocument({ rpc }, orderId, 'original')
    ).resolves.toEqual({
      data: null,
      error,
    });
  });
});

describe('loadTrackingAmendment', () => {
  const trackedOrder = {
    ...order,
    payment_status: 'paid',
    shipping_status: 'shipped',
    updated_at: '2026-11-22T07:00:00Z',
    paid_at: '2026-11-22T06:00:00Z',
    shipped_at: '2026-11-22T07:00:00Z',
    delivered_at: null,
    cancelled_at: null,
  };

  it('binds the lookup to its storefront and returns the valid live view', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...amendment, order: trackedOrder, items },
      error: null,
    });
    await expect(
      loadTrackingAmendment(
        { rpc },
        orderId,
        'synthetic-store',
        'test-token',
        null
      )
    ).resolves.toEqual({
      amendment,
      projection: { order: trackedOrder, items },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'read_paid_order_amendment_tracking',
      {
        p_order_id: orderId,
        p_merchant_slug: 'synthetic-store',
        p_tracking_token: 'test-token',
        p_email: null,
      }
    );
  });

  it.each([
    {
      data: { ...amendment, order: { ...trackedOrder, subtotal: null }, items },
      error: null,
    },
    {
      data: { ...amendment, state: 'unknown', order: trackedOrder, items },
      error: null,
    },
    { data: null, error: { code: 'PGRST202' } },
  ])('preserves the tracking fallback for invalid or unavailable revisions', async (result) => {
    const rpc = vi.fn().mockResolvedValue(result);
    await expect(
      loadTrackingAmendment(
        { rpc },
        orderId,
        'synthetic-store',
        'test-token',
        null
      )
    ).resolves.toBeNull();
  });
});
