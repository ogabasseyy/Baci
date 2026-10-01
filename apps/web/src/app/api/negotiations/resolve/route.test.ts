// @vitest-environment node

import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mockCheckCsrfProtection = vi.fn();
const mockNotifyNegotiationResponse = vi
  .fn()
  .mockResolvedValue({ sent: 1, failed: 0, errors: [] });
const mockNotifyGuestNegotiationResponseByEmail = vi
  .fn()
  .mockResolvedValue(undefined);
const mockLoggerError = vi.fn();

vi.mock('@/lib/negotiation-notifications', () => ({
  notifyGuestNegotiationResponseByEmail: (...args: unknown[]) =>
    mockNotifyGuestNegotiationResponseByEmail(...args),
  notifyNegotiationResponse: (...args: unknown[]) =>
    mockNotifyNegotiationResponse(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  getUserAccess: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockUser = { id: 'user-123' } as never;
const mockSupabase = {
  from: vi.fn(),
};
const updateCalls: { payload: unknown; eq: unknown[][] }[] = [];
const updateQueue: QueryResult[] = [];

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const validBody = {
  negotiationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  status: 'accepted',
};

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/negotiations/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'csrf-token=valid-csrf-token',
      'x-csrf-token': 'valid-csrf-token',
    },
  });
}

function createUpdateChain(result: QueryResult, payload: unknown) {
  const eqCalls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  chain.eq = (...args: unknown[]) => {
    eqCalls.push(args);
    return chain;
  };
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason?: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  updateCalls.push({ payload, eq: eqCalls });
  return chain;
}

function mockSupabaseUpdates(...results: QueryResult[]) {
  updateQueue.length = 0;
  updateQueue.push(...results);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table !== 'negotiation_requests') {
      throw new Error(`Unexpected table ${table}`);
    }
    return {
      update: vi.fn((payload: unknown) =>
        createUpdateChain(
          updateQueue.shift() ?? { data: null, error: null },
          payload
        )
      ),
    };
  });
}

async function setupAuth(options: {
  authenticated?: boolean;
  hasAccess?: boolean;
  merchantId?: string;
}) {
  const { authenticateApiRequest, getUserAccess, hasPermission } = await import(
    '@/lib/api-auth'
  );

  if (options.authenticated === false) {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'No session',
      supabase: null,
    });
  } else {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockUser,
      error: null,
      supabase: mockSupabase as never,
    });
  }

  if (options.hasAccess === false) {
    vi.mocked(getUserAccess).mockResolvedValue(null);
    vi.mocked(hasPermission).mockReturnValue(false);
  } else {
    vi.mocked(getUserAccess).mockResolvedValue({
      merchantId: options.merchantId ?? 'merchant-123',
      role: 'owner',
      permissions: {},
    } as never);
    vi.mocked(hasPermission).mockReturnValue(true);
  }
}

describe('POST /api/negotiations/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyNegotiationResponse.mockResolvedValue({
      sent: 1,
      failed: 0,
      errors: [],
    });
    mockNotifyGuestNegotiationResponseByEmail.mockResolvedValue(undefined);
    updateCalls.length = 0;
    updateQueue.length = 0;
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 401 when not authenticated', async () => {
    await setupAuth({ authenticated: false });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(401);
  });

  it('returns 403 when user lacks permission', async () => {
    await setupAuth({ authenticated: true, hasAccess: false });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    await setupAuth({ authenticated: true, hasAccess: true });

    const response = await POST(
      createRequest({ negotiationId: 'not-uuid', status: 'accepted' })
    );

    expect(response.status).toBe(400);
  });

  it('returns 403 when csrf validation fails', async () => {
    await setupAuth({ authenticated: true, hasAccess: true });
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'Invalid CSRF token' });
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
    expect(mockNotifyNegotiationResponse).not.toHaveBeenCalled();
  });

  it('updates a pending guest negotiation and sends the guest email', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: null,
        customer_email: 'guest@example.com',
        type: 'single',
        item_info: { name: 'Product', product_slug: 'product-slug' },
        offered_price: 5000,
        status: 'accepted',
      },
      error: null,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'accepted',
      notified: true,
      channel: 'email',
    });
    expect(updateCalls[0]).toMatchObject({ payload: { status: 'accepted' } });
    expect(updateCalls[0]?.eq).toEqual([
      ['id', validBody.negotiationId],
      ['merchant_id', 'merchant-123'],
      ['status', 'pending'],
    ]);
    expect(mockNotifyGuestNegotiationResponseByEmail).toHaveBeenCalledWith({
      acceptedPrice: 5000,
      email: 'guest@example.com',
      itemName: 'Product',
      merchantId: 'merchant-123',
      negotiationId: validBody.negotiationId,
      negotiationType: 'single',
      productSlug: 'product-slug',
      status: 'accepted',
    });
  });

  it('returns conflict when the negotiation is no longer pending', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: 'This request was already handled. Pull to refresh.',
      code: 'already_resolved',
    });
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
    expect(mockNotifyNegotiationResponse).not.toHaveBeenCalled();
  });

  it('returns an update failure when the pending status update fails', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to resolve. Please try again.',
      code: 'update_failed',
    });
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
    expect(mockNotifyNegotiationResponse).not.toHaveBeenCalled();
  });

  it('resolves guest negotiations without notification when no email is available', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: null,
        customer_email: null,
        type: 'single',
        item_info: { name: 'Product' },
        offered_price: 5000,
        status: 'accepted',
      },
      error: null,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'accepted',
      notified: false,
      reason: 'no_customer_email',
    });
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
    expect(mockNotifyNegotiationResponse).not.toHaveBeenCalled();
  });

  it('marks phone-only negotiations for manual follow-up', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: null,
        customer_email: null,
        customer_phone: '2348031234567',
        type: 'single',
        item_info: { name: 'Product' },
        offered_price: 5000,
        status: 'accepted',
      },
      error: null,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'accepted',
      notified: false,
      reason: 'no_customer_email',
      manualContactAvailable: true,
    });
  });

  it('rolls the status back when notification delivery fails', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockNotifyGuestNegotiationResponseByEmail.mockRejectedValueOnce(
      new Error('email provider down')
    );
    mockSupabaseUpdates(
      {
        data: {
          id: validBody.negotiationId,
          merchant_id: 'merchant-123',
          customer_id: null,
          customer_email: 'guest@example.com',
          type: 'single',
          item_info: { name: 'Product' },
          offered_price: 5000,
          status: 'accepted',
        },
        error: null,
      },
      { data: { id: validBody.negotiationId }, error: null }
    );

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to notify the customer. Please try again.',
      code: 'notification_failed',
    });
    expect(updateCalls[1]).toMatchObject({ payload: { status: 'pending' } });
    expect(updateCalls[1]?.eq).toEqual([
      ['id', validBody.negotiationId],
      ['merchant_id', 'merchant-123'],
      ['status', 'accepted'],
    ]);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve negotiation request',
        negotiationId: validBody.negotiationId,
      })
    );
  });

  it('surfaces rollback failure when notification delivery fails after status update', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockNotifyGuestNegotiationResponseByEmail.mockRejectedValueOnce(
      new Error('email provider down')
    );
    mockSupabaseUpdates(
      {
        data: {
          id: validBody.negotiationId,
          merchant_id: 'merchant-123',
          customer_id: null,
          customer_email: 'guest@example.com',
          type: 'single',
          item_info: { name: 'Product' },
          offered_price: 5000,
          status: 'accepted',
        },
        error: null,
      },
      { data: null, error: { message: 'rollback denied' } }
    );

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error:
        'Failed to notify the customer and restore request state. Please refresh before retrying.',
      code: 'rollback_failed',
    });
    expect(updateCalls[1]).toMatchObject({ payload: { status: 'pending' } });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve negotiation request',
        negotiationId: validBody.negotiationId,
        rolledBack: false,
      })
    );
  });

  it('sends a customer notification for authenticated customers', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: 'customer-456',
        customer_email: null,
        type: 'total',
        item_info: null,
        offered_price: 5000,
        status: 'rejected',
      },
      error: null,
    });

    const response = await POST(
      createRequest({
        negotiationId: validBody.negotiationId,
        status: 'rejected',
      })
    );

    expect(response.status).toBe(200);
    expect(mockNotifyNegotiationResponse).toHaveBeenCalledWith(
      'customer-456',
      'total',
      'rejected',
      validBody.negotiationId,
      null,
      null,
      null
    );
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
  });

  it('falls back to captured email when authenticated customer push reaches no devices', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockNotifyNegotiationResponse.mockResolvedValueOnce({
      sent: 0,
      failed: 0,
      errors: [],
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: 'customer-456',
        customer_email: 'customer@example.com',
        type: 'single',
        item_info: { name: 'Product', product_slug: 'product-slug' },
        offered_price: 5000,
        status: 'accepted',
      },
      error: null,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'accepted',
      notified: true,
      channel: 'email',
    });
    expect(mockNotifyNegotiationResponse).toHaveBeenCalledWith(
      'customer-456',
      'single',
      'accepted',
      validBody.negotiationId,
      'Product',
      5000,
      'product-slug'
    );
    expect(mockNotifyGuestNegotiationResponseByEmail).toHaveBeenCalledWith({
      acceptedPrice: 5000,
      email: 'customer@example.com',
      itemName: 'Product',
      merchantId: 'merchant-123',
      negotiationId: validBody.negotiationId,
      negotiationType: 'single',
      productSlug: 'product-slug',
      status: 'accepted',
    });
  });

  it('reports no delivery channel when customer push reaches no devices and no email exists', async () => {
    await setupAuth({
      authenticated: true,
      hasAccess: true,
      merchantId: 'merchant-123',
    });
    mockNotifyNegotiationResponse.mockResolvedValueOnce({
      sent: 0,
      failed: 0,
      errors: [],
    });
    mockSupabaseUpdates({
      data: {
        id: validBody.negotiationId,
        merchant_id: 'merchant-123',
        customer_id: 'customer-456',
        customer_email: null,
        type: 'single',
        item_info: { name: 'Product' },
        offered_price: 5000,
        status: 'accepted',
      },
      error: null,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'accepted',
      notified: false,
      reason: 'no_delivery_channel',
    });
    expect(mockNotifyGuestNegotiationResponseByEmail).not.toHaveBeenCalled();
  });
});
