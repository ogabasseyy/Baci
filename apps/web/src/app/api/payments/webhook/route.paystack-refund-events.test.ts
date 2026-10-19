import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mockReconcilePaystackRefundEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/payments/reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mockReconcilePaystackRefundEvent,
}));

vi.mock('@/env', async () => {
  const actual = await vi.importActual('@/env');
  return {
    ...(actual as Record<string, unknown>),
    env: {
      KORAPAY_SECRET_KEY: 'test-korapay-secret',
      PAYSTACK_SECRET_KEY: 'test-paystack-secret',
      NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void>) => {
      callback().catch(() => {
        // Ignore errors in background tasks
      });
    }),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/go54', () => ({
  isGo54Configured: vi.fn(() => true),
  registerDomain: vi.fn(),
}));

let mockServiceClient: ReturnType<typeof createMockSupabaseClient>;
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => mockServiceClient),
}));

function createMockSupabaseClient() {
  return {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    rpc: vi.fn((_name: string, _args?: unknown) => {
      const result = { data: null, error: null };
      return Object.assign(Promise.resolve(result), {
        single: () => Promise.resolve(result),
      });
    }),
  };
}

function createSignature(payload: string, secret: string): string {
  return createHmac('sha512', secret).update(payload).digest('hex');
}

function createMockRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): NextRequest {
  const bodyString = JSON.stringify(body);
  const url = 'https://example.com/api/payments/webhook';

  return {
    text: vi.fn(() => Promise.resolve(bodyString)),
    json: vi.fn(() => Promise.resolve(body)),
    headers: new Headers(headers),
    url,
  } as unknown as NextRequest;
}

describe('POST /api/payments/webhook paystack refund events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceClient = createMockSupabaseClient();
    process.env.KORAPAY_SECRET_KEY = 'test-korapay-secret';
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    mockReconcilePaystackRefundEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles a signed Paystack refund event before charge handling', async () => {
    const body = {
      event: 'refund.processed',
      data: { transaction_reference: 'PAYMENT-1', status: 'processed' },
    };
    const request = createMockRequest(body, {
      'x-paystack-signature': createSignature(
        JSON.stringify(body),
        'test-paystack-secret'
      ),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockReconcilePaystackRefundEvent).toHaveBeenCalledWith(
      mockServiceClient,
      'PAYMENT-1',
      'processed'
    );
  });

  it('rejects a malformed Paystack refund payload before reconciling', async () => {
    const body = {
      event: 'refund.processed',
      data: { id: 'not-a-number' },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(400);
    expect(mockReconcilePaystackRefundEvent).not.toHaveBeenCalled();
  });

  it('rejects a signed refund event without a usable identifier', async () => {
    const body = { event: 'refund.processed', data: { status: 'processed' } };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(400);
    expect(mockReconcilePaystackRefundEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsigned Paystack refund event', async () => {
    const response = await POST(
      createMockRequest(
        {
          event: 'refund.processed',
          data: { transaction_reference: 'PAYMENT-1' },
        },
        { 'x-paystack-signature': 'invalid' }
      )
    );
    expect(response.status).toBe(401);
    expect(mockReconcilePaystackRefundEvent).not.toHaveBeenCalled();
  });

  it.each([
    42,
    {},
    [],
  ])('ignores a signed payload with a non-string event (%s)', async (event) => {
    const body = { event, data: { reference: 'PAYMENT-1' } };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Event ignored',
    });
    expect(mockReconcilePaystackRefundEvent).not.toHaveBeenCalled();
  });
});
