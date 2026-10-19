import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithCsrf } from '@/lib/api-client';

import { fetchSavedAccountCart } from './shared-cart-saved-cart-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithCsrf);
const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
function snapshot() {
  return {
    cartId,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId,
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 3,
  };
}
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}
beforeEach(() => {
  fetchMock.mockReset();
});

describe('shared-cart saved-cart client', () => {
  it('reads the saved account cart without creating one', async () => {
    const saved = snapshot();
    fetchMock.mockResolvedValue(jsonResponse({ cart: saved }));
    await expect(fetchSavedAccountCart('shop')).resolves.toEqual({
      cart: saved,
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/cart/account?merchantSlug=shop',
      { method: 'GET' }
    );
  });

  it('returns a null saved cart distinctly from a failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cart: null }));
    await expect(fetchSavedAccountCart('shop')).resolves.toEqual({
      cart: null,
      ok: true,
    });
  });
});
