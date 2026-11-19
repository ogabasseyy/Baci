import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostRequest,
  csrfSpy,
  expectNoWrites,
  getMocks,
  mockProvenCustomer,
  ORDER_ID,
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
  it('rejects unauthenticated requests before rate limiting, CSRF or input parsing', async () => {
    getMocks().authenticateApiRequest.mockResolvedValueOnce({
      error: 'unauthorized',
      user: null,
      supabase: null,
    });
    expect((await POST(buildPostRequest('{oops', false))).status).toBe(401);
    expect(getMocks().ensureActionRateLimit).not.toHaveBeenCalled();
    expect(csrfSpy).not.toHaveBeenCalled();
  });
  it('does not consume the authenticated rate limit when CSRF validation fails', async () => {
    const response = await POST(buildPostRequest({ orderId: ORDER_ID }, false));
    expect(response.status).toBe(403);
    expect(csrfSpy).toHaveBeenCalledOnce();
    expect(getMocks().ensureActionRateLimit).not.toHaveBeenCalled();
  });
  it('rate-limits authenticated callers with the oxygen-initiation bucket', async () => {
    getMocks().ensureActionRateLimit.mockResolvedValueOnce(false);
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Too many Oxygen requests. Please try again shortly.',
    });
    expect(getMocks().ensureActionRateLimit).toHaveBeenCalledWith(
      SESSION_USER_ID,
      'initiation',
      10
    );
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(csrfSpy).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('uses the initiation bucket and never the availability bucket', async () => {
    mockProvenCustomer();

    await POST(buildPostRequest({ orderId: ORDER_ID }));

    expect(getMocks().ensureActionRateLimit).toHaveBeenCalledWith(
      SESSION_USER_ID,
      'initiation',
      10
    );
    for (const call of getMocks().ensureActionRateLimit.mock.calls) {
      expect(call[1]).not.toBe('availability');
    }
  });
  it('rejects a cookie POST without a CSRF token after auth', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }, false));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Invalid CSRF token',
      message:
        'CSRF token validation failed. Please refresh the page and try again.',
    });
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
  it('lets a Bearer request past CSRF to the policy verdict', async () => {
    mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(csrfSpy).toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
  });
  it('checks CSRF before parsing the body', async () => {
    mockProvenCustomer();

    const response = await POST(buildPostRequest('{oops', false));

    expect(response.status).toBe(403);
  });
  it('returns 400 for an invalid JSON body after auth', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest('{oops'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
    expect(getMocks().authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });
});
