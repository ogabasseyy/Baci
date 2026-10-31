import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateApiRequest, postShippingQuotes } = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  postShippingQuotes: vi.fn(),
}));

vi.mock('@/app/api/shipping/quotes/route', () => ({
  POST: postShippingQuotes,
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest }));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const BODY = {
  receiver: { address: '5 Balogun Street', phone: '08011112222' },
};

function buildRequest() {
  return new NextRequest(
    `https://usebaci.com/api/orders/${ORDER_ID}/shipping/gigl-quote`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        cookie: 'sb-session=abc',
      },
      body: JSON.stringify(BODY),
    }
  );
}

describe('bugfix: admin GIG quote crashed with "#state" when the route re-wrapped the request', () => {
  beforeEach(() => {
    postShippingQuotes.mockReset();
    authenticateApiRequest.mockReset();
    authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user-1' },
    });
  });

  it('rejects an unauthenticated caller before reading the body or delegating', async () => {
    authenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const request = buildRequest();
    const { POST } = await import('./route');

    const response = await POST(request, {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(request.bodyUsed).toBe(false);
    expect(postShippingQuotes).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Production crashed with "Cannot read private member #state" when this
  // route passed the incoming request object to `new NextRequest(request, …)`.
  it('delegates a freshly built request with the order headers when the admin app asks for a GIG quote', async () => {
    postShippingQuotes.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const request = buildRequest();
    const { POST } = await import('./route');

    const response = await POST(request, {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    expect(response.status).toBe(200);
    expect(postShippingQuotes).toHaveBeenCalledTimes(1);
    const delegated = postShippingQuotes.mock.calls[0][0] as NextRequest;
    expect(delegated).not.toBe(request);
    expect(delegated).toBeInstanceOf(NextRequest);
    expect(delegated.method).toBe('POST');
    expect(delegated.nextUrl.pathname).toBe(
      `/api/orders/${ORDER_ID}/shipping/gigl-quote`
    );
    expect(delegated.headers.get('x-baci-admin-order-mode')).toBe('1');
    expect(delegated.headers.get('x-baci-admin-order-id')).toBe(ORDER_ID);
    expect(delegated.headers.get('authorization')).toBe('Bearer token');
    expect(delegated.cookies.get('sb-session')?.value).toBe('abc');
    expect(await delegated.json()).toEqual(BODY);
  });

  it('returns a readable error without logging error details when the quotes route throws', async () => {
    postShippingQuotes.mockRejectedValue(
      new Error('provider body: secret-token')
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { POST } = await import('./route');

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to get GIG quote',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error getting admin order GIGL quote',
      { errorName: 'Error' }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'secret-token'
    );
  });
});
