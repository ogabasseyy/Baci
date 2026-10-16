import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithCsrf } from '@/lib/api-client';

import { linkAccountCart } from './shared-cart-account-link-client';

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

describe('shared-cart account-link client', () => {
  it('posts an explicit account choice with its stable operation id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ cart: snapshot(), replayed: false })
    );
    const input = { choice: 'keep_current' as const, operationId: 'op-1' };
    await expect(linkAccountCart(input, 'shop')).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('keeps a lost link response retryable for same-operation replay', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      linkAccountCart({ choice: 'keep_current', operationId: 'op-1' }, 'shop')
    ).resolves.toMatchObject({ ok: false, retryable: true });
  });
});
