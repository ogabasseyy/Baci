import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/order-update-email', () => ({
  sendOrderUpdatedEmail: vi.fn(),
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { PATCH } from './route';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const validPayload = {
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

const editResult = {
  change_category: 'financial',
  changed_fields: ['items', 'total'],
  customer_email: 'ada@example.com',
  merchant_id: 'merchant-1',
  notify_customer: false,
  order_id: ORDER_ID,
};

const updatedOrder = {
  id: ORDER_ID,
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

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

function createMockUser(): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

function createSupabaseMock({
  adTracking = null,
}: {
  adTracking?: Record<string, unknown> | null;
} = {}) {
  let selectedColumns = '';
  const single = vi.fn().mockImplementation(() =>
    Promise.resolve({
      data:
        selectedColumns === 'ad_tracking'
          ? { ad_tracking: adTracking }
          : updatedOrder,
      error: null,
    })
  );
  const selectBuilder = {
    eq: vi.fn(() => selectBuilder),
    single,
  };
  const select = vi.fn((columns: string) => {
    selectedColumns = columns;
    return selectBuilder;
  });
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: editResult, error: null });

  return {
    rpc,
    supabase: { from, rpc } as unknown as SupabaseClient,
  };
}

function mockAuthenticated(supabase: SupabaseClient) {
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    error: null,
    supabase,
    user: createMockUser(),
  });
}

function callPatch(request: NextRequest) {
  return PATCH(request, { params: Promise.resolve({ id: ORDER_ID }) });
}

describe('PATCH /api/orders/[id]/edit transaction discount metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
  });

  it('uses the transactional edit RPC for item changes that invalidate allocations', async () => {
    const { supabase, rpc } = createSupabaseMock({
      adTracking: {
        fbclid: 'fb-1',
        baci_transaction_discount: { lineDiscounts: [], version: 2 },
      },
    });
    mockAuthenticated(supabase);

    const response = await callPatch(createRequest(validPayload));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'update_admin_order_with_transaction_discount_metadata',
      expect.objectContaining({ p_payload: validPayload })
    );
  });

  it('covers metadata-only cleanup through the transactional edit RPC', async () => {
    const { supabase, rpc } = createSupabaseMock({
      adTracking: {
        baci_transaction_discount: { lineDiscounts: [], version: 3 },
      },
    });
    mockAuthenticated(supabase);

    const response = await callPatch(createRequest(validPayload));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'update_admin_order_with_transaction_discount_metadata',
      expect.objectContaining({ p_order_id: ORDER_ID })
    );
  });
});
