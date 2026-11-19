import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOwnerCtx,
  buildPostRequest,
  buildSupabaseMock,
  csrfSpy,
  expectNoWrites,
  getMocks,
  mockAuthSuccess,
  mockProvenCustomer,
  ORDER_ID,
  ORDER_ROW,
  POST,
} from './route.test-helpers';

describe('POST /api/payments/oxygen/attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().ensureActionRateLimit.mockResolvedValue(true);
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);
    mockProvenCustomer();
  });
  it('denies proven staff on a guest order with the 403 guest message (D1)', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: { ...ORDER_ROW, customer_id: null }, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    getMocks().getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Sign in to continue with Oxygen.',
      code: 'oxygen_guest_not_allowed',
    });
    expectNoWrites(supabase.writeSpies);
  });
  it('denies a proven customer with the rollout-disabled verdict', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });
  it('denies proven staff on a customer order with the rollout verdict', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    getMocks().getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });
  it('maps an order load failure to 500 without writes', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Unable to load order' });
    expectNoWrites(supabase.writeSpies);
  });
  it('maps a customers lookup failure to 500 instead of masking it as 404', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: null, error: { message: 'customers down' } },
    });
    mockAuthSuccess(supabase.client);

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Unable to load order' });
    expectNoWrites(supabase.writeSpies);
  });
  it('falls back to 403 when CSRF reports invalid without a response', async () => {
    csrfSpy.mockResolvedValueOnce({ valid: false });

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'CSRF validation failed' });
  });
});
