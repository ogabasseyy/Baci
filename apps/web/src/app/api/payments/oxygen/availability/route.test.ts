import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGetRequest,
  csrfSpy,
  expectNoWrites,
  GET,
  getMocks,
  mockProvenCustomer,
  ORDER_ID,
  SESSION_USER_ID,
} from './route.test-helpers';

describe('GET /api/payments/oxygen/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().distributedRateLimit.mockResolvedValue({ allowed: true });
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);
    mockProvenCustomer();
  });
  it('rejects unauthenticated requests before rate limiting, CSRF or input parsing', async () => {
    getMocks().authenticateApiRequest.mockResolvedValueOnce({
      error: 'unauthorized',
      user: null,
      supabase: null,
    });
    expect((await GET(buildGetRequest('?orderId=invalid', false))).status).toBe(
      401
    );
    expect(getMocks().distributedRateLimit).not.toHaveBeenCalled();
    expect(csrfSpy).not.toHaveBeenCalled();
  });
  it('rate-limits authenticated callers with the oxygen-availability bucket', async () => {
    getMocks().distributedRateLimit.mockResolvedValueOnce({ allowed: false });
    const supabase = mockProvenCustomer();

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Too many Oxygen requests. Please try again shortly.',
    });
    expect(getMocks().distributedRateLimit).toHaveBeenCalledWith(
      SESSION_USER_ID,
      'availability',
      10
    );
    expect(csrfSpy).not.toHaveBeenCalled();
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('uses the availability bucket and never the initiation bucket', async () => {
    mockProvenCustomer();

    await GET(buildGetRequest(`?orderId=${ORDER_ID}`));

    expect(getMocks().distributedRateLimit).toHaveBeenCalledWith(
      SESSION_USER_ID,
      'availability',
      10
    );
    for (const call of getMocks().distributedRateLimit.mock.calls) {
      expect(call[1]).not.toBe('initiation');
    }
  });
  it('calls the CSRF helper though it auto-passes safe methods', async () => {
    mockProvenCustomer();

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`, false));
    const body = await response.json();

    expect(csrfSpy).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
  });
  it('falls back to 403 when CSRF reports invalid without a response', async () => {
    csrfSpy.mockResolvedValueOnce({ valid: false });

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`, false));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'CSRF validation failed' });
  });
  it.each([
    ['missing orderId', ''],
    ['empty orderId', '?orderId='],
    ['non-uuid orderId', '?orderId=not-a-uuid'],
  ])('returns 400 for %s after auth', async (_label, query) => {
    const supabase = mockProvenCustomer();

    const response = await GET(buildGetRequest(query));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
    expect(body.details.orderId).toBeDefined();
    expect(Object.keys(body).sort()).toEqual(['details', 'error']);
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('ignores unknown query params and proceeds', async () => {
    mockProvenCustomer();

    const response = await GET(
      buildGetRequest(`?orderId=${ORDER_ID}&injected=x`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
  });
});
