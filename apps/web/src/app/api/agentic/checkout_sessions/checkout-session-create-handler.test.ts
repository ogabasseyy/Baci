import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleAgenticCheckoutSessionCreate } from './checkout-session-create-handler';

type MockAgenticMerchantContext = {
  agentic_checkout_enabled: boolean;
  id: string;
  pay_on_delivery_enabled: boolean;
  paystack_subaccount_code: string | null;
  slug: string;
};

const { mockResolveAgenticMerchantContextFromRpc } = vi.hoisted(() => ({
  mockResolveAgenticMerchantContextFromRpc:
    vi.fn<(...args: unknown[]) => Promise<MockAgenticMerchantContext | null>>(),
}));

vi.mock('@/lib/agentic/auth', () => ({
  getIdempotencyKey: vi.fn(() => 'idem-1'),
  verifyAgenticApiKey: vi.fn(() => true),
}));

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc:
    mockResolveAgenticMerchantContextFromRpc,
}));

vi.mock('@/lib/agentic/request-integrity', () => ({
  AGENTIC_REQUEST_INTEGRITY_ERRORS: {
    INVALID_REQUEST_ID_FORMAT: 'Invalid request ID format',
    INVALID_TIMESTAMP: 'Invalid timestamp',
    MISSING_SIGNING_SECRET: 'Missing signing secret',
    REQUEST_ID_TOO_LONG: 'Request ID too long',
    STALE_TIMESTAMP: 'Stale timestamp',
    UNSUPPORTED_API_VERSION: 'Unsupported api version',
  },
  getAgenticSigningSecrets: vi.fn(() => ['signing-secret']),
  verifyAgenticRequestIntegrity: vi.fn(() => ({
    apiVersion: '2026-04-30',
    ok: true,
    requestId: 'req_123',
  })),
}));

vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/agentic/ucp-cart-checkout-conversion', () => ({
  convertUcpCartToCheckout: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

function buildCreateRequest() {
  return new NextRequest('http://localhost/api/agentic/checkout_sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'idem-1',
    },
    body: JSON.stringify({ items: [{ id: 'product-1', quantity: 1 }] }),
  });
}

describe('handleAgenticCheckoutSessionCreate merchant resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      ok: true,
      error: null,
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
  });

  it('resolves the merchant through the scoped context RPC without the admin client', async () => {
    mockResolveAgenticMerchantContextFromRpc.mockResolvedValue({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });

    const response = await handleAgenticCheckoutSessionCreate(
      buildCreateRequest()
    );

    expect(mockResolveAgenticMerchantContextFromRpc).toHaveBeenCalledTimes(1);
    expect(mockResolveAgenticMerchantContextFromRpc).toHaveBeenCalledWith();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Agentic checkout disabled',
    });
  });

  it('responds 500 and stops when the scoped RPC returns no merchant', async () => {
    mockResolveAgenticMerchantContextFromRpc.mockResolvedValue(null);

    const response = await handleAgenticCheckoutSessionCreate(
      buildCreateRequest()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Agentic merchant not found',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });
});
