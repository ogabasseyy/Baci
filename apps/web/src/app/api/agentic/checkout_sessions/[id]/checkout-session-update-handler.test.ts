import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { handleAgenticCheckoutSessionUpdate } from './checkout-session-update-handler';

const SESSION_ID = 'session-1';

const {
  mockCalculateCheckoutSession,
  mockGetAgenticCheckoutSession,
  mockReadAgenticMutationRequest,
  mockReserveAgenticIdempotencyKey,
  mockReserveAgenticRequestId,
  mockResolveAgenticMerchantContext,
  mockVerifyAgenticApiKey,
  mockVerifyAgenticRequestAccess,
  updateChain,
} = vi.hoisted(() => {
  const updateChain = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  updateChain.update.mockReturnValue(updateChain);
  updateChain.eq.mockReturnValue(updateChain);
  updateChain.is.mockReturnValue(updateChain);
  updateChain.in.mockReturnValue(updateChain);
  updateChain.select.mockReturnValue(updateChain);
  updateChain.maybeSingle.mockResolvedValue({
    data: { session_id: 'session-1' },
    error: null,
  });
  return {
    mockCalculateCheckoutSession: vi.fn(),
    mockGetAgenticCheckoutSession: vi.fn(),
    mockReadAgenticMutationRequest: vi.fn(),
    mockReserveAgenticIdempotencyKey: vi.fn(),
    mockReserveAgenticRequestId: vi.fn(),
    mockResolveAgenticMerchantContext: vi.fn(),
    mockVerifyAgenticApiKey: vi.fn(() => true),
    mockVerifyAgenticRequestAccess: vi.fn(() => ({ ok: true as const })),
    updateChain,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: mockVerifyAgenticRequestAccess,
}));
vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: mockCalculateCheckoutSession,
}));
vi.mock('@/lib/agentic/checkout-completion-response', () => ({
  hasCheckoutPaymentSideEffect: vi.fn(() => false),
}));
vi.mock('@/lib/agentic/checkout-session-record', () => ({
  CHECKOUT_SESSION_MUTABLE_STATUSES: ['pending', 'processing'],
  getAgenticCheckoutSession: mockGetAgenticCheckoutSession,
}));
vi.mock('@/lib/agentic/checkout-session-response', () => ({
  buildCheckoutSessionStateResponse: vi.fn((input: { sessionId: string }) => ({
    id: input.sessionId,
    status: 'incomplete',
  })),
}));
vi.mock('@/lib/agentic/checkout-storage', () => ({
  buildCheckoutSessionUpdate: vi.fn(() => ({ status: 'pending' })),
  mapCheckoutSessionStatus: vi.fn(() => 'incomplete'),
}));
vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: mockReserveAgenticIdempotencyKey,
}));
vi.mock('@/lib/agentic/idempotency-response', () => ({
  getAgenticIdempotencyErrorStatus: vi.fn(() => 409),
}));
vi.mock('@/lib/agentic/idempotency-response-storage', () => ({
  buildStoredAgenticIdempotencyResponse: vi.fn(
    async (input: { response: unknown; status: number }) =>
      NextResponse.json(input.response as Record<string, unknown>, {
        status: input.status,
      })
  ),
}));
vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout is disabled',
  isAgenticMerchantCheckoutEnabled: vi.fn(() => true),
  resolveAgenticMerchantContext: mockResolveAgenticMerchantContext,
}));
vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: mockReadAgenticMutationRequest,
}));
vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: mockReserveAgenticRequestId,
}));
vi.mock('@/lib/agentic/request-replay-response', () => ({
  getAgenticReplayErrorStatus: vi.fn(() => 409),
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => updateChain),
  })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: vi.fn(() => 'https://ogabassey.usebaci.com'),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

function request() {
  return new NextRequest(
    `https://example.com/api/agentic/checkout_sessions/${SESSION_ID}`,
    { method: 'POST' }
  );
}

function props(id: string = SESSION_ID) {
  return { params: Promise.resolve({ id }) };
}

const session = {
  cart_items: [],
  currency: 'NGN',
  metadata: {},
  session_id: SESSION_ID,
  shipping_address: null,
  shipping_method: null,
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyAgenticApiKey.mockReturnValue(true);
  mockVerifyAgenticRequestAccess.mockReturnValue({ ok: true });
  mockReadAgenticMutationRequest.mockResolvedValue({
    ok: true,
    agentId: 'agent-1',
    apiVersion: '2026-03-01',
    body: { fulfillment_option_id: 'standard' },
    rawBody: '{"fulfillment_option_id":"standard"}',
    idempotencyKey: 'idem-1',
    method: 'POST',
    pathname: `/api/agentic/checkout_sessions/${SESSION_ID}`,
    requestId: 'req-1',
  });
  mockResolveAgenticMerchantContext.mockResolvedValue({
    id: 'merchant-1',
    slug: 'ogabassey',
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
  });
  mockReserveAgenticIdempotencyKey.mockResolvedValue({
    ok: true,
    state: 'reserved',
  });
  mockReserveAgenticRequestId.mockResolvedValue({ ok: true });
  mockGetAgenticCheckoutSession.mockResolvedValue({
    data: session,
    error: null,
  });
  mockCalculateCheckoutSession.mockResolvedValue({
    fulfillmentOptions: [],
    lineItems: [],
    messages: [],
    selectedOptionId: 'standard',
    totals: [],
  });
  updateChain.maybeSingle.mockResolvedValue({
    data: { session_id: SESSION_ID },
    error: null,
  });
});

describe('handleAgenticCheckoutSessionUpdate', () => {
  it('rejects requests without a valid agentic API key', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const response = await handleAgenticCheckoutSessionUpdate(
      request(),
      props()
    );

    expect(response.status).toBe(401);
  });

  it('rejects invalid route params', async () => {
    const response = await handleAgenticCheckoutSessionUpdate(
      request(),
      props('bad id!')
    );

    expect(response.status).toBe(400);
  });

  it('reserves receipts under the verified agent and updates the session', async () => {
    const response = await handleAgenticCheckoutSessionUpdate(
      request(),
      props()
    );

    expect(response.status).toBe(200);
    expect(mockReserveAgenticIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        route: 'checkout_sessions.update',
      })
    );
    expect(mockReserveAgenticRequestId).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' })
    );
    expect(
      vi.mocked(buildStoredAgenticIdempotencyResponse)
    ).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', status: 200 })
    );
    // Silence unused-import lint for the direct mock handles.
    expect(reserveAgenticIdempotencyKey).toBe(mockReserveAgenticIdempotencyKey);
    expect(reserveAgenticRequestId).toBe(mockReserveAgenticRequestId);
  });

  it('returns 404 when the session does not exist', async () => {
    mockGetAgenticCheckoutSession.mockResolvedValue({
      data: null,
      error: null,
    });

    const response = await handleAgenticCheckoutSessionUpdate(
      request(),
      props()
    );

    expect(response.status).toBe(404);
  });

  it('returns 409 when the session can no longer be updated', async () => {
    mockGetAgenticCheckoutSession.mockResolvedValue({
      data: { ...session, status: 'completed' },
      error: null,
    });

    const response = await handleAgenticCheckoutSessionUpdate(
      request(),
      props()
    );

    expect(response.status).toBe(409);
  });
});
