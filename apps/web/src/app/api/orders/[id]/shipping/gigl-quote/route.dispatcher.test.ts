import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const delegatedPost = vi.fn();

vi.mock('@/app/api/shipping/quotes/route', () => ({ POST: delegatedPost }));

describe('Admin order GIGL quote alias dispatcher', () => {
  it('adds the protected order-mode headers and preserves the request body', async () => {
    delegatedPost.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const body = {
      receiver: {
        address: '5 Balogun Street',
        city: 'Ikeja',
        state: 'Lagos',
        phone: '08011112222',
      },
    };
    const request = new NextRequest(
      'https://usebaci.com/api/orders/11111111-1111-4111-8111-111111111111/shipping/gigl-quote',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const { POST } = await import('./route');
    const response = await POST(request, {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    });
    expect(response.status).toBe(200);
    expect(delegatedPost).toHaveBeenCalledTimes(1);
    const delegated = delegatedPost.mock.calls[0][0] as NextRequest;
    expect(delegated).toBeInstanceOf(NextRequest);
    expect(delegated.headers.get('x-baci-admin-order-mode')).toBe('1');
    expect(delegated.headers.get('x-baci-admin-order-id')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(delegated.nextUrl.pathname).toBe(
      '/api/orders/11111111-1111-4111-8111-111111111111/shipping/gigl-quote'
    );
    expect(await delegated.json()).toEqual(body);
  });
});
