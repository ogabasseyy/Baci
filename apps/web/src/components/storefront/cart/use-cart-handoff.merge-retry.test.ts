import { cartLineIdentity } from '@baci/shared/cart';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as csrf from '@/lib/csrf';
import { useCartHandoff } from './use-cart-handoff';

beforeEach(() => {
  vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('test-csrf-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('resends the exact merge body on retry even if picks change', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [
      {
        id: 'incoming-line',
        item: { productId: 'p1' },
        quantity: 2,
        unitPriceMinor: 1000,
        lineTotalMinor: 2000,
        available: true,
      },
    ],
    merchantId: 'merchant-1',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 1,
  };
  const preview = () =>
    new Response(
      JSON.stringify({
        status: 'pending',
        merchant: { id: 'merchant-1', slug: 'shop' },
        snapshot,
        expiresAt: '2099-01-01T00:00:00Z',
      })
    );
  const destination = () =>
    new Response(
      JSON.stringify({
        cart: {
          ...snapshot,
          cartId: 'dest-cart',
          version: 3,
          lines: [
            {
              ...snapshot.lines[0],
              id: 'destination-line',
              quantity: 1,
              lineTotalMinor: 1000,
            },
          ],
        },
      })
    );
  const bodies: unknown[] = [];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(preview())
    .mockResolvedValueOnce(destination())
    .mockImplementation(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      });
    });
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public-retry' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  const identityKey = cartLineIdentity({ productId: 'p1' });
  act(() => {
    result.current.setConflicts([
      { item: { productId: 'p1' }, existing: {}, incoming: {} },
    ]);
    result.current.setResolutions({ [identityKey]: 'incoming' });
  });
  await act(async () => {
    await result.current.continueMerge();
  });
  act(() => {
    result.current.setResolutions({ [identityKey]: 'existing' });
  });
  await act(async () => {
    await result.current.continueMerge();
  });
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({
    lines: expect.arrayContaining([
      expect.objectContaining({ sourceLineId: 'incoming-line' }),
      expect.objectContaining({ sourceLineId: 'destination-line' }),
    ]),
    resolutions: [{ item: { productId: 'p1' }, keep: 'incoming' }],
  });
  expect(bodies[1]).toEqual(bodies[0]);
  expect(result.current.attemptSent).toBe(true);
});
