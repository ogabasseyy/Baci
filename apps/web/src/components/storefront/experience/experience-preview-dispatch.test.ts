import { expect, it, vi } from 'vitest';
import { createPreviewDispatcher } from './experience-preview-dispatch';

it('private dispatch constructs synthetic commerce and never calls a live network/cart adapter', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  const dispatch = createPreviewDispatcher(
    {
      catalog: { revision: '1', products: [] },
      capabilities: [],
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: '1',
      },
    },
    { go: vi.fn(), open: vi.fn() }
  );
  expect(
    await dispatch({ method: 'checkout.open', args: {} } as never)
  ).toEqual({ status: 'ok', value: { presented: false } });
  expect(
    await dispatch({ method: 'cart.readPublic', args: {} } as never)
  ).toMatchObject({ status: 'ok', value: { lines: [] } });
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
