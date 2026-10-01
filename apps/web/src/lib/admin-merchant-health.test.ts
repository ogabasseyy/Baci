import { describe, expect, it, vi } from 'vitest';
import { getAdminMerchantHealthPage } from '@/lib/admin-merchant-health';

const query = {
  health: 'all',
  limit: 50,
  offset: 0,
  search: undefined,
  sortBy: 'gmv',
} as const;

const merchantRow = {
  active_days: 4,
  business_name: 'Baci Store',
  email: 'owner@example.com',
  excluded_non_ngn_or_unknown_paid_orders: 0,
  health_status: 'at_risk',
  joined_at: '2026-06-11T00:00:00.000Z',
  last_order_date: '2026-06-01',
  merchant_id: '11111111-1111-4111-8111-111111111111',
  storefront_slug: 'baci-store',
  total_count: 73,
  total_gmv: 1_200,
  total_orders: 2,
};

describe('getAdminMerchantHealthPage', () => {
  it('uses the bounded, server-sorted v2 RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const result = await getAdminMerchantHealthPage({ rpc } as never, query);
    expect(result).toMatchObject({ data: [], error: null, total: 0 });
    expect(rpc).toHaveBeenCalledWith('get_admin_merchant_health_v2', {
      p_health_status: null,
      p_limit: 50,
      p_offset: 0,
      p_search: null,
      p_sort_by: 'gmv',
    });
  });

  it('fails closed for malformed paged rows', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ merchant_id: 'not-a-uuid' }],
      error: null,
    });
    const result = await getAdminMerchantHealthPage({ rpc } as never, query);
    expect(result.error?.code).toBe('INVALID_MERCHANT_HEALTH_PAYLOAD');
  });

  it('passes a selected health filter to the v2 RPC and returns its total', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [merchantRow], error: null });

    const result = await getAdminMerchantHealthPage({ rpc } as never, {
      ...query,
      health: 'at_risk',
    });

    expect(rpc).toHaveBeenCalledWith('get_admin_merchant_health_v2', {
      p_health_status: 'at_risk',
      p_limit: 50,
      p_offset: 0,
      p_search: null,
      p_sort_by: 'gmv',
    });
    expect(result).toMatchObject({
      data: [merchantRow],
      error: null,
      total: 73,
    });
  });

  it('returns the RPC error without treating its payload as a valid page', async () => {
    const error = { code: '42501', message: 'Platform admin access required' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(
      getAdminMerchantHealthPage({ rpc } as never, query)
    ).resolves.toEqual({ data: [], error, total: 0 });
  });

  it('retains the matching total when an offset page has no rows', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [merchantRow], error: null });

    const result = await getAdminMerchantHealthPage({ rpc } as never, {
      ...query,
      offset: 100,
    });

    expect(result).toEqual({ data: [], error: null, total: 73 });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_admin_merchant_health_v2', {
      p_health_status: null,
      p_limit: 1,
      p_offset: 0,
      p_search: null,
      p_sort_by: 'gmv',
    });
  });
});
