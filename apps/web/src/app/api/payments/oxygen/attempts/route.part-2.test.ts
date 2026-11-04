import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';
import {
  buildDeniedStaffCtx,
  buildPostRequest,
  buildSupabaseMock,
  CUSTOMER_ID,
  expectNoWrites,
  getMocks,
  MERCHANT_B_ID,
  mockAuthSuccess,
  mockProvenCustomer,
  ORDER_ID,
  ORDER_ROW,
  OTHER_CUSTOMER_ID,
  POST,
  SESSION_USER_ID,
} from './route.test-helpers';

describe('POST /api/payments/oxygen/attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().ensureActionRateLimit.mockResolvedValue(true);
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);
    mockProvenCustomer();
  });
  it.each([
    ['missing orderId', {}],
    ['non-uuid orderId', { orderId: 'not-a-uuid' }],
  ])('returns 400 for %s after auth', async (_label, body) => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest(body));
    const parsed = await response.json();

    expect(response.status).toBe(400);
    expect(parsed.error).toBe('Invalid request');
    expect(parsed.details.orderId).toBeDefined();
    expect(Object.keys(parsed).sort()).toEqual(['details', 'error']);
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('strips unknown body keys and proceeds', async () => {
    mockProvenCustomer();

    const response = await POST(
      buildPostRequest({ orderId: ORDER_ID, injected: 'x' })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('oxygen_rollout_disabled');
  });
  it('returns a byte-identical 401 for any auth failure, pre-load', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });
    const variants = [
      { user: null, error: 'Invalid or expired token', supabase: null },
      { user: null, error: 'Not authenticated', supabase: null },
      { user: { id: SESSION_USER_ID }, error: null, supabase: null },
      {
        user: null,
        error: 'Authentication failed',
        supabase: supabase.client,
      },
    ];
    const serialized: string[] = [];
    for (const variant of variants) {
      getMocks().authenticateApiRequest.mockResolvedValueOnce(variant);
      const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
      const body = await response.json();
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      serialized.push(JSON.stringify(body));
    }
    expect(new Set(serialized).size).toBe(1);
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('returns a byte-identical 404 across the full uniformity matrix', async () => {
    const cases: Array<{
      label: string;
      orderResult: { data: unknown; error: unknown };
      customerResult: { data: unknown; error: unknown };
      staffCtx: MerchantContext | null;
    }> = [
      {
        label: 'missing order',
        orderResult: { data: null, error: null },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'guessed UUID of another customer order',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'cross-customer session',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
        staffCtx: null,
      },
      {
        label: 'cross-merchant order',
        orderResult: {
          data: { ...ORDER_ROW, merchant_id: MERCHANT_B_ID },
          error: null,
        },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'staff denied the orders edit grant',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
        staffCtx: buildDeniedStaffCtx(),
      },
      {
        label: 'null-customer order on the customer path',
        orderResult: { data: { ...ORDER_ROW, customer_id: null }, error: null },
        customerResult: { data: { id: CUSTOMER_ID }, error: null },
        staffCtx: null,
      },
    ];
    const serialized: string[] = [];
    for (const testCase of cases) {
      const supabase = buildSupabaseMock(testCase);
      mockAuthSuccess(supabase.client);
      getMocks().getMerchantForApiRequest.mockResolvedValue(testCase.staffCtx);

      const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
      const body = await response.json();

      expect(response.status, testCase.label).toBe(404);
      expect(body, testCase.label).toEqual({ error: 'Order not found' });
      serialized.push(JSON.stringify(body));
      expectNoWrites(supabase.writeSpies);
    }
    expect(new Set(serialized).size).toBe(1);
  });
});
