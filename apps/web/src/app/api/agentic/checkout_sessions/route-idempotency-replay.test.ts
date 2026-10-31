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

type MockAgenticMerchantContext = {
  agentic_checkout_enabled?: boolean;
  id: string;
  slug: string;
};

const mockResolveAgenticMerchantContext = vi.fn<
  () => Promise<MockAgenticMerchantContext | null>
>(() => Promise.resolve({ id: 'merchant-1', slug: 'ogabassey' }));

vi.mock('@/lib/agentic/auth', () => ({
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
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
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

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

describe('POST /api/agentic/checkout_sessions idempotency replay ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue({} as never);
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
  });

  it('stores a disabled checkout response after claiming idempotency', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      slug: 'ogabassey',
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/checkout_sessions', {
        body: JSON.stringify({
          currency: 'ngn',
          items: [{ id: 'product-1', quantity: 1 }],
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agentic checkout disabled' });
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        merchantId: 'merchant-1',
        response: { error: 'Agentic checkout disabled' },
        route: 'checkout_sessions.create',
        status: 403,
      })
    );
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('replays a stored idempotency result before checking request replay', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      requestHash: 'a'.repeat(64),
      response: { id: 'agentic_session_1', status: 'ready_for_payment' },
      state: 'replay',
      status: 201,
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({
      error: 'Replay request id',
      ok: false,
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/checkout_sessions', {
        body: JSON.stringify({
          currency: 'ngn',
          items: [{ id: 'product-1', quantity: 1 }],
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      id: 'agentic_session_1',
      status: 'ready_for_payment',
    });
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });
});
