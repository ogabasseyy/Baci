import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import { fetchOxygenFollowUps } from './fetchOxygenFollowUps';

const orderId = '00000000-0000-4000-8000-000000000001';
const merchantId = '20000000-0000-4000-8000-000000000001';
const candidate = {
  order_id: orderId,
  follow_up_status: 'oxygen_processing',
  last_activity_at: '2026-11-17T08:00:00Z',
};
const order = {
  id: orderId,
  order_number: 'ORD-1',
  customer_id: '30000000-0000-4000-8000-000000000001',
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: null,
  currency: 'NGN',
  total: 10000,
  payment_status: 'unpaid',
  payment_method: 'oxygen',
  created_at: '2026-11-17T07:00:00Z',
  cancelled_at: null,
};

describe('Oxygen follow-up fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: [candidate], error: null });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ in: mocks.in });
    mocks.in.mockResolvedValue({ data: [order], error: null });
  });

  it('downgrades customer action when the order was reassigned during lookup', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status: 'customer_action',
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    mocks.in.mockResolvedValue({
      data: [{ ...order, customer_id: '30000000-0000-4000-8000-000000000002' }],
      error: null,
    });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('needs_review');
  });

  it('keeps customer action when the order binding still matches', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status: 'customer_action',
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('customer_action');
  });

  it.each([
    'pending',
    'bnpl_pending',
  ])('does not ask the customer to continue when payment status is %s', async (payment_status) => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status: 'customer_action',
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    mocks.in.mockResolvedValue({
      data: [{ ...order, payment_status }],
      error: null,
    });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('needs_review');
  });

  it.each([
    'failed',
    'expired',
    'pending',
    'bnpl_approved',
  ])('flags a changed payment status of %s during approved follow-up', async (payment_status) => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...candidate, follow_up_status: 'approved_pending' }],
      error: null,
    });
    mocks.in.mockResolvedValue({
      data: [{ ...order, payment_status }],
      error: null,
    });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('needs_review');
  });

  it.each([
    0, -100,
  ])('escalates nonpositive customer-action amount %s', async (total) => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status: 'customer_action',
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    mocks.in.mockResolvedValue({ data: [{ ...order, total }], error: null });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('needs_review');
  });

  it.each([
    'USD',
    null,
    '',
  ])('keeps non-NGN customer action review-only: %s', async (currency) => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status: 'customer_action',
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    mocks.in.mockResolvedValue({ data: [{ ...order, currency }], error: null });
    const result = await fetchOxygenFollowUps(merchantId);
    expect(result.orders[0]?.oxygen_follow_up_status).toBe('needs_review');
    expect(mocks.select).toHaveBeenCalledWith(
      expect.stringContaining('currency')
    );
  });

  it.each([
    'customer_action',
    'oxygen_processing',
    'approved_pending',
  ])('keeps conflicting %s orders review-only', async (follow_up_status) => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...candidate,
          follow_up_status,
          order_customer_id: order.customer_id,
        },
      ],
      error: null,
    });
    expect(
      (await fetchOxygenFollowUps(merchantId)).orders[0]
        ?.oxygen_follow_up_status
    ).toBe(follow_up_status);
    for (const fields of [
      { customer_id: null },
      { currency: 'USD' },
      { total: 0 },
      { total: -1 },
    ]) {
      mocks.rpc.mockResolvedValue({
        data: [
          {
            ...candidate,
            follow_up_status,
            order_customer_id:
              'customer_id' in fields && fields.customer_id === null
                ? null
                : order.customer_id,
          },
        ],
        error: null,
      });
      mocks.in.mockResolvedValue({
        data: [{ ...order, ...fields }],
        error: null,
      });
      expect(
        (await fetchOxygenFollowUps(merchantId)).orders[0]
          ?.oxygen_follow_up_status
      ).toBe('needs_review');
    }
  });

  it('marks non-array and oversized payloads incomplete instead of throwing', async () => {
    mocks.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual({
      orders: [],
      isIncomplete: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();

    const oversizedCandidates = Array.from({ length: 251 }, (_, index) => ({
      ...candidate,
      order_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));
    mocks.rpc.mockResolvedValue({ data: oversizedCandidates, error: null });
    mocks.in.mockImplementation((_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ ...order, id })),
      error: null,
    }));

    const cappedResult = await fetchOxygenFollowUps(merchantId);
    expect(cappedResult.isIncomplete).toBe(true);
    expect(cappedResult.orders).toHaveLength(250);

    mocks.rpc.mockResolvedValue({ data: [candidate], error: null });
    mocks.in.mockResolvedValue({
      data: Array.from({ length: 51 }, (_, index) => ({
        ...order,
        id:
          index === 0
            ? orderId
            : `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      })),
      error: null,
    });
    const oversizedBatch = await fetchOxygenFollowUps(merchantId);
    expect(oversizedBatch).toEqual({
      orders: [expect.objectContaining({ id: orderId })],
      isIncomplete: true,
    });
  });

  it('escalates to needs_review when an order is cancelled after candidate lookup', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...candidate, follow_up_status: 'approved_pending' }],
      error: null,
    });
    mocks.in.mockResolvedValue({
      data: [{ ...order, cancelled_at: '2026-11-17T08:05:00Z' }],
      error: null,
    });

    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual({
      orders: [
        expect.objectContaining({
          id: orderId,
          oxygen_follow_up_status: 'needs_review',
        }),
      ],
      isIncomplete: false,
    });
  });
});
