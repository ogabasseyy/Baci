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
vi.mock('./useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant' } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((config) => config),
}));

import { fetchOxygenFollowUps } from './useOxygenFollowUps';

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
  customer_id: null,
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: null,
  total: 10000,
  payment_status: 'unpaid',
  payment_method: 'oxygen',
  created_at: '2026-11-17T07:00:00Z',
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

  it('joins safe Oxygen categories to merchant-scoped orders', async () => {
    const result = await fetchOxygenFollowUps(merchantId);
    expect(mocks.rpc).toHaveBeenCalledWith('oxygen_follow_up_candidates', {
      p_merchant_id: merchantId,
    });
    expect(mocks.eq).toHaveBeenCalledWith('merchant_id', merchantId);
    expect(mocks.in).toHaveBeenCalledWith('id', [orderId]);
    expect(result).toEqual([
      expect.objectContaining({
        id: orderId,
        oxygen_follow_up_status: 'oxygen_processing',
        follow_up_at: candidate.last_activity_at,
        attempt_count: 1,
      }),
    ]);
  });

  it('does not query orders when the provider status lookup fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    await expect(fetchOxygenFollowUps(merchantId)).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('fails visibly if order details cannot be loaded', async () => {
    mocks.in.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    await expect(fetchOxygenFollowUps(merchantId)).rejects.toThrow();
  });

  it('rejects unrecognized provider status projections', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...candidate, follow_up_status: 'raw provider message' }],
      error: null,
    });
    await expect(fetchOxygenFollowUps(merchantId)).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not invent orders omitted by the authenticated order query', async () => {
    mocks.in.mockResolvedValue({ data: [], error: null });
    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual([]);
  });

  it('does not read order details when no Oxygen follow-up is needed', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not tell staff to contact a customer if the order became paid', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...candidate, follow_up_status: 'customer_action' }],
      error: null,
    });
    mocks.in.mockResolvedValue({
      data: [{ ...order, payment_status: 'paid' }],
      error: null,
    });
    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual([
      expect.objectContaining({
        payment_status: 'paid',
        oxygen_follow_up_status: 'needs_review',
      }),
    ]);
  });

  it('flags conflicting approval evidence for review', async () => {
    mocks.in.mockResolvedValue({
      data: [{ ...order, payment_status: 'bnpl_approved' }],
      error: null,
    });
    await expect(fetchOxygenFollowUps(merchantId)).resolves.toEqual([
      expect.objectContaining({ oxygen_follow_up_status: 'needs_review' }),
    ]);
  });

  it('rejects an invalid merchant identifier before any database call', async () => {
    await expect(fetchOxygenFollowUps('not-a-uuid')).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
