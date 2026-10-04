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
  getSavingsIdentifierParams: (searchParams: URLSearchParams) => ({
    merchantId: searchParams.get('merchantId') ?? undefined,
    merchantSlug: searchParams.get('merchantSlug') ?? undefined,
  }),
  resolveCustomerSavingsContext: (...args: unknown[]) =>
    mockResolveCustomerSavingsContext(...args),
}));

import { POST } from './route';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/savings/goals',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

function rawPostRequest(body: string) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/savings/goals',
    {
      body,
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

function simpleProductData() {
  return {
    condition: 'used',
    id: '00000000-0000-4000-8000-000000000101',
    images: ['https://cdn.example.com/iphone.jpg'],
    name: 'iPhone 13 Pro Max',
    price: '800000',
    variants: [],
  };
}

describe('/api/storefront/customer/savings/goals', () => {
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

  it('returns 403 on POST when savings feature is disabled', async () => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: { rpc: vi.fn() },
    });
    mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
      autoDebitEnabled: true,
      paystackEnabled: true,
      savingsEnabled: false,
    });

    const response = await POST(
      postRequest({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('CUSTOMER_SAVINGS_DISABLED');
  });

  it('returns 400 for invalid POST goal input', async () => {
    const response = await POST(
      postRequest({
        contributionAmount: 0,
        merchantSlug: 'ogabassey',
        sourceMode: 'manual',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed POST JSON', async () => {
    const response = await POST(rawPostRequest('{'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'MALFORMED_JSON',
      error: 'Malformed JSON',
    });
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('creates a savings goal on POST', async () => {
    const productQuery = createProductQuery({
      data: simpleProductData(),
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            contribution_id: 'contrib-1',
            current_amount: '20000',
            goal_id: 'goal-1',
            goal_status: 'active',
            success: true,
            wallet_balance: '180000',
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
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        initialContributionAmount: 20000,
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_customer_savings_goal',
      expect.objectContaining({
        p_customer_id: 'customer-1',
        p_merchant_id: 'merchant-1',
        p_product_snapshot: expect.objectContaining({
          name: 'iPhone 13 Pro Max',
          selectionStatus: 'exact',
          variantId: null,
        }),
        p_target_amount: 800000,
        p_variant_id: null,
      })
    );
    expect(body).toEqual({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      contributionId: 'contrib-1',
      currentAmount: 20000,
      goalId: 'goal-1',
      goalStatus: 'active',
      success: true,
      walletBalance: 180000,
    });
  });

  it('passes the client goal idempotency key to the creation RPC', async () => {
    const productQuery = createProductQuery({
      data: simpleProductData(),
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            contribution_id: 'contrib-1',
            current_amount: '20000',
            goal_id: 'goal-1',
            goal_status: 'active',
            success: true,
            wallet_balance: '180000',
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
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        goalIdempotencyKey: 'a5bb8c9e-4c0e-4a2f-9c1d-7e6f5a4b3c2d',
        initialContributionAmount: 20000,
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_customer_savings_goal',
      expect.objectContaining({
        p_goal_idempotency_key: 'a5bb8c9e-4c0e-4a2f-9c1d-7e6f5a4b3c2d',
      })
    );
  });

  it('returns 500 when savings goal creation RPC fails unexpectedly', async () => {
    const productQuery = createProductQuery({
      data: simpleProductData(),
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'XX000',
          message: 'database unavailable',
        },
      }),
    };

    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'XX000',
      error: 'Failed to create savings goal',
    });
  });

  it('maps RPC conflicts to 409 when initial contribution exceeds wallet balance', async () => {
    const productQuery = createProductQuery({
      data: simpleProductData(),
      error: null,
    });
    const mockSupabase = {
      from: vi.fn(() => productQuery),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0001',
          message: 'insufficient_wallet_balance',
        },
      }),
    };

    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await POST(
      postRequest({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        initialContributionAmount: 20000,
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('insufficient_wallet_balance');
  });

  it('rejects creating a multi-variant savings goal without an exact variant', async () => {
    const productQuery = createProductQuery({
      data: {
        ...simpleProductData(),
        variants: [
          {
            attributes: { storage: '256GB' },
            id: '00000000-0000-4000-8000-000000000102',
            price_override: '850000',
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
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 850000,
        termsAccepted: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('SAVINGS_DEVICE_VARIANT_REQUIRED');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('persists the selected variant snapshot and rejects a stale lower price', async () => {
    const productQuery = createProductQuery({
      data: {
        ...simpleProductData(),
        variants: [
          {
            attributes: { storage: '256GB' },
            condition: 'used',
            id: '00000000-0000-4000-8000-000000000102',
            price_override: '850000',
            primary_image: 'https://cdn.example.com/iphone-256.jpg',
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

    const staleResponse = await POST(
      postRequest({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 800000,
        termsAccepted: true,
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    );

    expect(staleResponse.status).toBe(409);
    expect((await staleResponse.json()).code).toBe(
      'SAVINGS_DEVICE_PRICE_STALE'
    );
    expect(mockSupabase.rpc).not.toHaveBeenCalled();

    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          contribution_id: 'contrib-1',
          current_amount: '20000',
          goal_id: 'goal-1',
          goal_status: 'active',
          success: true,
          wallet_balance: '180000',
        },
      ],
      error: null,
    });

    const response = await POST(
      postRequest({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        merchantSlug: 'ogabassey',
        nonWithdrawableAccepted: true,
        productId: '00000000-0000-4000-8000-000000000101',
        sourceMode: 'manual',
        startDate: '2026-05-21',
        targetAmount: 850000,
        termsAccepted: true,
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_customer_savings_goal',
      expect.objectContaining({
        p_product_snapshot: expect.objectContaining({
          selectionStatus: 'exact',
          variantId: '00000000-0000-4000-8000-000000000102',
          variantLabel: 'Storage: 256GB',
        }),
        p_target_amount: 850000,
        p_variant_id: '00000000-0000-4000-8000-000000000102',
      })
    );
  });
});
