import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveCustomerSavingsContext = vi.fn();
const mockGetCustomerSavingsFeatureSettings = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/app/api/storefront/customer/savings/shared', () => ({
  getCustomerSavingsFeatureSettings: (...args: unknown[]) =>
    mockGetCustomerSavingsFeatureSettings(...args),
  resolveCustomerSavingsContext: (...args: unknown[]) =>
    mockResolveCustomerSavingsContext(...args),
}));

import { POST } from './route';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/savings/goals/swap-device',
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

function createProductQuery(result: {
  data: Record<string, unknown> | null;
  error: null | Record<string, unknown>;
}) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => query),
  };
  return query;
}

describe('/api/storefront/customer/savings/goals/swap-device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { authScope: 'customer' },
      user: { email: 'jane@example.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
    mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
      autoDebitEnabled: true,
      paystackEnabled: true,
      savingsEnabled: true,
    });
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await POST(
      postRequest({
        goalId: '00000000-0000-4000-8000-000000000201',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 400 when the payload is invalid', async () => {
    const response = await POST(postRequest({ merchantSlug: 'ogabassey' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('swaps a savings goal to a validated product variant price', async () => {
    const productQuery = createProductQuery({
      data: {
        condition: 'used',
        id: '00000000-0000-4000-8000-000000000101',
        images: ['https://cdn.example.com/iphone.jpg'],
        name: 'iPhone 15 Pro',
        price: '700000',
        variants: [
          {
            attributes: { storage: '256GB' },
            condition: 'used',
            id: '00000000-0000-4000-8000-000000000102',
            images: ['https://cdn.example.com/iphone-256.jpg'],
            price_override: '650000',
            primary_image: 'https://cdn.example.com/iphone-256.jpg',
          },
        ],
      },
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            current_amount: '120000',
            goal_id: 'goal-1',
            goal_status: 'active',
            success: true,
            target_amount: '650000',
          },
        ],
        error: null,
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        goalId: '00000000-0000-4000-8000-000000000201',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSupabase.from).toHaveBeenCalledWith('products');
    expect(productQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('variants:product_variants')
    );
    expect(productQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productQuery.eq).toHaveBeenCalledWith(
      'id',
      '00000000-0000-4000-8000-000000000101'
    );
    expect(productQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'swap_customer_savings_goal_device',
      expect.objectContaining({
        p_customer_id: 'customer-1',
        p_goal_id: '00000000-0000-4000-8000-000000000201',
        p_merchant_id: 'merchant-1',
        p_product_id: '00000000-0000-4000-8000-000000000101',
        p_product_snapshot: expect.objectContaining({
          image: 'https://cdn.example.com/iphone-256.jpg',
          name: 'iPhone 15 Pro',
          variantLabel: 'Storage: 256GB',
        }),
        p_target_amount: 650000,
        p_variant_id: '00000000-0000-4000-8000-000000000102',
      })
    );
    expect(body).toEqual({
      currentAmount: 120000,
      goalId: 'goal-1',
      goalStatus: 'active',
      success: true,
      targetAmount: 650000,
    });
  });

  it('returns 500 when the swap rpc fails unexpectedly', async () => {
    const productQuery = createProductQuery({
      data: {
        condition: 'used',
        id: '00000000-0000-4000-8000-000000000101',
        images: ['https://cdn.example.com/iphone.jpg'],
        name: 'iPhone 15 Pro',
        price: '700000',
        variants: [],
      },
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'boom' },
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        goalId: '00000000-0000-4000-8000-000000000201',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'swap_customer_savings_goal_device',
      expect.objectContaining({
        p_goal_id: '00000000-0000-4000-8000-000000000201',
        p_product_id: '00000000-0000-4000-8000-000000000101',
      })
    );
    expect(body).toEqual({
      code: 'SAVINGS_DEVICE_SWAP_FAILED',
      error: 'Failed to swap savings device',
    });
  });

  it('rejects variants that do not belong to the selected product', async () => {
    const productQuery = createProductQuery({
      data: {
        condition: 'used',
        id: '00000000-0000-4000-8000-000000000101',
        images: [],
        name: 'iPhone 15 Pro',
        price: '700000',
        variants: [],
      },
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn(),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        goalId: '00000000-0000-4000-8000-000000000201',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe('SAVINGS_DEVICE_VARIANT_NOT_FOUND');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('requires an exact variant when swapping onto a product that has variants', async () => {
    const productQuery = createProductQuery({
      data: {
        condition: 'used',
        id: '00000000-0000-4000-8000-000000000101',
        images: [],
        name: 'iPhone 15 Pro',
        price: '700000',
        variants: [
          {
            attributes: { storage: '256GB' },
            id: '00000000-0000-4000-8000-000000000102',
            price_override: '650000',
          },
        ],
      },
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn(),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        goalId: '00000000-0000-4000-8000-000000000201',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('SAVINGS_DEVICE_VARIANT_REQUIRED');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
