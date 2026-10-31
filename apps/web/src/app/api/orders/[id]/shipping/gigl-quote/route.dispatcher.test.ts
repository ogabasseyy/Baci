import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postAdminOrderGiglQuote = vi.fn();

vi.mock('@/app/api/shipping/quotes/admin-order-gigl-quote', () => ({
  postAdminOrderGiglQuote,
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function buildRequest() {
  return new NextRequest(
    `https://usebaci.com/api/orders/${ORDER_ID}/shipping/gigl-quote`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receiver: { address: 'x', phone: 'y' } }),
    }
  );
}

describe('Admin order GIGL quote alias dispatcher', () => {
  beforeEach(() => {
    postAdminOrderGiglQuote.mockReset();
  });

  // Production crashed with "Cannot read private member #state" when this
  // route re-wrapped the incoming request with `new NextRequest(request, …)`.
  it('hands the original request to the quote handler instead of re-wrapping it', async () => {
    postAdminOrderGiglQuote.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const request = buildRequest();
    const { POST } = await import('./route');

    const response = await POST(request, {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    expect(response.status).toBe(200);
    expect(postAdminOrderGiglQuote).toHaveBeenCalledWith(request, {
      admin_order_id: ORDER_ID,
    });
  });

  it('returns a readable error when the quote handler throws', async () => {
    postAdminOrderGiglQuote.mockRejectedValue(new Error('boom'));
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
    consoleError.mockRestore();
  });
});
