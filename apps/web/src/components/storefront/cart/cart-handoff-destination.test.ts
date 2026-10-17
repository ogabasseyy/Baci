import { afterEach, expect, it, vi } from 'vitest';
import { fetchDestinationCart } from './cart-handoff-destination';

afterEach(() => vi.unstubAllGlobals());

it('returns the destination cart when one exists', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cart: { cartId: 'dest' } }), {
        status: 200,
      })
    )
  );
  await expect(fetchDestinationCart('shop')).resolves.toEqual({
    status: 'checked',
    cart: { cartId: 'dest' },
    bootstrapRequired: false,
  });
});

it('requires bootstrap after a proof-boundary 401', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'expired_proof' }), { status: 401 })
      )
  );
  await expect(fetchDestinationCart(null)).resolves.toEqual({
    status: 'checked',
    cart: null,
    bootstrapRequired: true,
  });
});

it('treats not_found as an absent destination cart', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'not_found' }), { status: 404 })
      )
  );
  await expect(fetchDestinationCart('shop')).resolves.toEqual({
    status: 'checked',
    cart: null,
    bootstrapRequired: false,
  });
});

it('reports an error for other failures', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      })
    )
  );
  await expect(fetchDestinationCart('shop')).resolves.toEqual({
    status: 'error',
  });
});
