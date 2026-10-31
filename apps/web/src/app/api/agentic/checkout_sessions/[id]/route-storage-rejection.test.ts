import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const mockBuildStoredAgenticIdempotencyResponse = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockResolveAgenticMerchantContext = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: vi.fn(() => true),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency-response-storage', () => ({
  buildStoredAgenticIdempotencyResponse:
    mockBuildStoredAgenticIdempotencyResponse,
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: vi.fn(),
}));

vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

function mockMissingSessionSupabase() {
  const readChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  readChain.eq.mockReturnValue(readChain);

  return {
    from: vi.fn((table: string) => {
      if (table !== 'checkout_sessions') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { select: vi.fn(() => readChain) };
    }),
  } as unknown as SupabaseClient;
}

function mockMutation(body: unknown, pathname: string) {
  vi.mocked(readAgenticMutationRequest).mockResolvedValue({
    agentId: null,
    apiVersion: '2026-04-30',
    body,
    idempotencyKey: 'idem-1',
    method: 'POST',
    ok: true,
    pathname,
    rawBody: JSON.stringify(body),
    requestId: 'req_123',
  });
}

describe('agentic checkout idempotency storage rejection handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
    mockBuildStoredAgenticIdempotencyResponse.mockRejectedValue(
      new Error('idempotency storage unavailable')
    );

    const supabase = mockMissingSessionSupabase();
    vi.mocked(createAdminClient).mockReturnValue(supabase);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(supabase);
  });

  it('logs and returns the route fallback when cancel response storage rejects', async () => {
    const pathname = '/api/agentic/checkout_sessions/agentic_session_1/cancel';
    mockMutation({}, pathname);

    const { POST } = await import('./cancel/route');
    const response = await POST(
      new NextRequest(`http://localhost${pathname}`, {
        headers: { 'Idempotency-Key': 'idem-1' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal Server Error' });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Agentic checkout cancel error',
        sessionId: 'agentic_session_1',
      })
    );
  });

  it('logs and returns the route fallback when update response storage rejects', async () => {
    const pathname = '/api/agentic/checkout_sessions/agentic_session_1';
    mockMutation({ shipping_address: { city: 'Lagos' } }, pathname);

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest(`http://localhost${pathname}`, {
        body: JSON.stringify({ shipping_address: { city: 'Lagos' } }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal Server Error' });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Agentic checkout update error',
        sessionId: 'agentic_session_1',
      })
    );
  });
});
