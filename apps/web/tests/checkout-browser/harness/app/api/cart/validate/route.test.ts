import { describe, expect, it } from 'vitest';
import { POST } from './route';

const csrf = {
  cookie: 'csrf-token=fixture-csrf-token',
  'x-csrf-token': 'fixture-csrf-token',
};

describe('fixture cart validation route', () => {
  it('rejects missing fixture CSRF and malformed cart data', async () => {
    const noCsrf = await POST(
      new Request('http://localhost/api/cart/validate', {
        method: 'POST',
        body: JSON.stringify({ cartItems: [] }),
      })
    );
    expect(noCsrf.status).toBe(403);
    const invalid = await POST(
      new Request('http://localhost/api/cart/validate', {
        method: 'POST',
        headers: csrf,
        body: JSON.stringify({ cartItems: 'invalid' }),
      })
    );
    expect(invalid.status).toBe(400);
  });

  it('returns the deterministic no-change result for valid cart data', async () => {
    const response = await POST(
      new Request('http://localhost/api/cart/validate', {
        method: 'POST',
        headers: csrf,
        body: JSON.stringify({ cartItems: [] }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      invalidProductIds: [],
      priceChanges: [],
    });
  });
});
