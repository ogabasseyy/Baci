import { describe, expect, it } from 'vitest';
import { adminMerchantHealthRowsSchema } from './admin-merchant-health-rpc';

const validRow = {
  active_days: 2,
  business_name: 'Baci Store',
  email: 'owner@example.com',
  health_status: 'healthy',
  joined_at: '2026-03-20T10:00:00.000Z',
  last_order_date: '2026-03-19',
  merchant_id: '123e4567-e89b-42d3-a456-426614174001',
  storefront_slug: 'baci-store',
  total_gmv: '400.50',
  total_count: 20,
  total_orders: 2,
  excluded_non_ngn_or_unknown_paid_orders: 0,
};

describe('adminMerchantHealthRowsSchema', () => {
  it('accepts bounded factual merchant health rows', () => {
    expect(adminMerchantHealthRowsSchema.safeParse([validRow]).success).toBe(
      true
    );
  });

  it.each([
    { merchant_id: 'not-a-uuid' },
    { health_status: 'active' },
    { total_gmv: 'NaN' },
    { total_orders: -1 },
    { total_count: -1 },
    { joined_at: 'not-a-date' },
    { last_order_date: '2026-03-19T10:00:00.000Z' },
  ])('rejects malformed RPC data: %o', (override) => {
    expect(
      adminMerchantHealthRowsSchema.safeParse([{ ...validRow, ...override }])
        .success
    ).toBe(false);
  });
});
