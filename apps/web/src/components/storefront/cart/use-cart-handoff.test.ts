import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';

afterEach(() => vi.unstubAllGlobals());
it('removes the pairing fragment even when preview retrieval fails', async () => {
  window.history.replaceState(null, '', '/cart/handoff#pairing-secret');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'pairing-secret', handoffId: 'public-id' })
  );
  expect(window.location.hash).toBe('');
  await waitFor(() => expect(result.current.loadError).toBeTruthy());
  expect(result.current.destChecked).toBe(false);
});
it('clears stale merge picks when redemption reports a version conflict', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [],
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
      JSON.stringify({ cart: { ...snapshot, cartId: 'dest-cart', version: 3 } })
    );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(destination())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'version_conflict' }), {
          status: 409,
        })
      )
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(destination())
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  act(() => {
    result.current.setConflicts([
      { item: { productId: 'p1' }, existing: {}, incoming: {} },
    ]);
    result.current.setResolutions({ p1: 'incoming' });
  });
  await act(async () => {
    await result.current.act('keep_existing');
  });
  expect(result.current.conflicts).toEqual([]);
  expect(result.current.resolutions).toEqual({});
  expect(result.current.redeemError).toMatch(/changed/);
  // The conflict definitively rejected the redemption, so the locked
  // choice is released and the shopper may choose again.
  expect(result.current.lockedChoice).toBeNull();
});

it('resends the exact merge body on retry even if picks change', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [],
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
      JSON.stringify({ cart: { ...snapshot, cartId: 'dest-cart', version: 3 } })
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
  const identityKey = JSON.stringify(['p1', null, null, []]);
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
  expect(bodies[1]).toEqual(bodies[0]);
  expect(result.current.attemptSent).toBe(true);
});

it('resends the persisted body for a top-level retry after remount', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [],
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
  const destination = (version: number) =>
    new Response(
      JSON.stringify({
        cart: { ...snapshot, cartId: 'dest-cart', version },
      })
    );
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(preview())
    .mockResolvedValueOnce(destination(3))
    .mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      });
    });
  vi.stubGlobal('fetch', fetchMock);
  const first = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public-remount' })
  );
  await waitFor(() => expect(first.result.current.destChecked).toBe(true));
  await act(async () => {
    await first.result.current.act('connect');
  });
  first.unmount();
  // After remount the destination reports a newer version; the retry
  // must still resend the original body under the same attempt.
  fetchMock
    .mockResolvedValueOnce(preview())
    .mockResolvedValueOnce(destination(9));
  const second = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public-remount' })
  );
  await waitFor(() => expect(second.result.current.destChecked).toBe(true));
  await act(async () => {
    await second.result.current.act('connect');
  });
  expect(bodies.length).toBeGreaterThanOrEqual(2);
  expect(bodies[bodies.length - 1]).toEqual(bodies[0]);
  expect(bodies[0]?.expectedDestVersion).toBe(3);
});

it('replays the persisted attempt when the preview reports consumed', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [],
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
      JSON.stringify({ cart: { ...snapshot, cartId: 'dest-cart', version: 3 } })
    );
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const replaceMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/cart', replace: replaceMock },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(preview())
    .mockResolvedValueOnce(destination())
    .mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      });
    });
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public-consumed' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  await act(async () => {
    await result.current.act('connect');
  });
  expect(bodies).toHaveLength(1);
  // The link now reads consumed (our first attempt committed but its
  // response was lost): reloading the preview must replay the exact
  // persisted body, and the replayed success finishes the flow.
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          // Production consumed previews return merchant: null; the
          // replay must use the scope recorded while pending.
          status: 'consumed',
          merchant: null,
          snapshot: null,
          expiresAt: '2099-01-01T00:00:00Z',
        })
      )
    )
    .mockImplementation(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ cart: snapshot }), {
        status: 200,
      });
    });
  await act(async () => {
    await result.current.loadPreview();
  });
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(urls.some((url) => url.includes('merchantSlug=shop'))).toBe(true);
  expect(replaceMock).toHaveBeenCalled();
  expect(result.current.lockedChoice).toBeNull();
});

it('does not lock the choice when merge preflight exits without sending', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [
      {
        id: 'incoming-line',
        item: { productId: 'p1' },
        quantity: 1,
        unitPriceMinor: 100,
        lineTotalMinor: 100,
      },
    ],
    merchantId: 'merchant-1',
    state: 'active',
    subtotalMinor: 100,
    totalMinor: 100,
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
          lines: Array.from({ length: 21 }, (_, index) => ({
            id: `dest-line-${index}`,
            item: { productId: `p${index + 1}` },
            quantity: 1,
            unitPriceMinor: 100,
            lineTotalMinor: 100,
          })),
        },
      })
    );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(destination())
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public-preflight' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  await act(async () => {
    await result.current.act('merge');
  });
  // Capacity preflight exits before anything is sent, so no choice
  // may be locked yet and Connect stays available.
  expect(result.current.lockedChoice).toBeNull();
  expect(result.current.redeemError).toMatch(/too many/);
});

it.each([
  'expired_proof',
  'invalid_proof',
])('accepts an empty destination after %s so bootstrap can replace its proof', async (code) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'pending',
            merchant: { id: 'm', slug: 'shop' },
            snapshot: null,
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code }), { status: 401 })
      )
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  expect(result.current.destinationError).toBeNull();
});
