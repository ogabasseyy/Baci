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
    expiresAt: '2026-10-19T04:00:00.000Z',
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
    fetchMock.mockResolvedValue(jsonResponse({ cart: snapshot() }));
    await expect(fetchSavedAccountCart('shop')).resolves.toEqual({
      cart: snapshot(),
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
