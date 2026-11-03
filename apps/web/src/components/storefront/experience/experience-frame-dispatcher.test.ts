import { expect, it, vi } from 'vitest';
import { createFrameDispatcher } from './experience-frame-dispatcher';

it('delegates published commerce only to its trusted host and presents navigation outside source', async () => {
  const dispatch = vi.fn(async () => ({ status: 'ok', value: 'normal host' }));
  const presentCanonicalLink = vi.fn(() => ({
    href: 'https://store.test/product',
  }));
  const setLink = vi.fn();
  const run = createFrameDispatcher({
    host: { dispatch } as never,
    launch: {} as never,
    nav: { presentCanonicalLink } as never,
    setLink,
    routes: {} as never,
  });
  expect(await run({ method: 'cart.readPublic' } as never)).toMatchObject({
    status: 'ok',
    value: 'normal host',
  });
  await run({
    method: 'navigation.open',
    requestId: 'one',
    args: { path: '/product' },
  } as never);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(setLink).toHaveBeenCalledWith({ href: 'https://store.test/product' });
});
