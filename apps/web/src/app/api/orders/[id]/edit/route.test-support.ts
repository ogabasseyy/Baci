import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

export const validPayload = {
  branch_id: null,
  customer: {
    email: 'ada@example.com',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Ada Buyer',
    phone: '+2348012345678',
  },
  discount_amount: 0,
  gift_wrapping_fee: 0,
  items: [
    {
      condition: 'new',
      image_url: 'https://cdn.example.test/s26.jpg',
      item_description: null,
      name: 'Samsung Galaxy S26',
      price: 1000000,
      product_id: '33333333-3333-4333-8333-333333333333',
      product_match_status: 'linked',
      quantity: 1,
      variant_id: null,
      variant_attributes: { color: 'Black', storage: '512GB' },
      variant_name: null,
    },
  ],
  notes: null,
  notify_customer: false,
  shipping_address: {
    address: '12 Allen Avenue',
    city: 'Ikeja',
    name: 'Ada Buyer',
    phone: '+2348012345678',
    state: 'Lagos',
  },
  shipping_fee: 2500,
  source: 'physical',
  tax_amount: 0,
};

export const editResult = {
  change_category: 'financial',
  changed_fields: ['items', 'total'],
  customer_email: 'ada@example.com',
  merchant_id: 'merchant-1',
  notify_customer: false,
  order_id: '11111111-1111-4111-8111-111111111111',
};

export const updatedOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  merchant_id: 'merchant-1',
  order_number: 'ORD-001',
  order_items: [
    {
      id: 'item-1',
      image_url: 'https://cdn.example.test/s26.jpg',
      name: 'Samsung Galaxy S26',
      price: 1000000,
      quantity: 1,
      variant_attributes: { color: 'Black', storage: '512GB' },
    },
  ],
  total: 1002500,
};

export function createEditRouteSupabaseMock({
  adTracking = null,
  refreshError = null,
  rpcError = null,
}: {
  adTracking?: Record<string, unknown> | null;
  refreshError?: { code?: string; message?: string } | null;
  rpcError?: { code?: string; message?: string } | null;
} = {}) {
  let selectedColumns = '';
  const single = vi.fn().mockImplementation(() => {
    if (selectedColumns === 'ad_tracking') {
      return Promise.resolve({
        data: { ad_tracking: adTracking },
        error: null,
      });
    }
    return Promise.resolve({
      data: refreshError ? null : updatedOrder,
      error: refreshError,
    });
  });
  const eq = vi.fn(() => selectBuilder);
  const selectBuilder = { eq, single };
  const select = vi.fn((columns: string) => {
    selectedColumns = columns;
    return selectBuilder;
  });
  const updateEq = vi.fn(() => updateBuilder);
  const updateBuilder = { eq: updateEq };
  const update = vi.fn(() => updateBuilder);
  const from = vi.fn(() => ({ select, update }));
  const rpc = vi.fn().mockResolvedValue({
    data: rpcError ? null : editResult,
    error: rpcError,
  });

  return {
    from,
    rpc,
    select,
    update,
    supabase: { from, rpc } as unknown as SupabaseClient,
  };
}
