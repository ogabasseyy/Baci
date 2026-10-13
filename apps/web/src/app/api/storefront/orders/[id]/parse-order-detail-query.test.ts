import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { parseOrderDetailQuery } from './parse-order-detail-query';

function requestWith(query: string) {
  return new NextRequest(
    `http://localhost/api/storefront/orders/order-1${query}`
  );
}

describe('parseOrderDetailQuery', () => {
  it('accepts the token and slug aliases', () => {
    const result = parseOrderDetailQuery(
      requestWith('?tracking_token=track-1&slug=test-store')
    );

    expect(result).toEqual({
      ok: true,
      query: {
        token: 'track-1',
        email: undefined,
        merchantSlug: 'test-store',
      },
    });
  });

  it('accepts the canonical parameter names', () => {
    const result = parseOrderDetailQuery(
      requestWith('?token=track-2&email=buyer@example.com&merchant_slug=shop')
    );

    expect(result).toEqual({
      ok: true,
      query: {
        token: 'track-2',
        email: 'buyer@example.com',
        merchantSlug: 'shop',
      },
    });
  });

  it('returns the 400 response for an invalid email', async () => {
    const result = parseOrderDetailQuery(requestWith('?email=not-an-email'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({
        error: 'Invalid request',
      });
    }
  });
});
