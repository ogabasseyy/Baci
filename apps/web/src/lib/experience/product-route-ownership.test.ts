import { expect, it } from 'vitest';
import { experienceOwnsProductRoute } from './product-route-ownership';

it('does not replace a native categorized PDP for home-only or editorial-only experiences', async () => {
  expect(
    await experienceOwnsProductRoute(
      [{ path: '/', view: 'home' }],
      '/devices/item',
      'item'
    )
  ).toBe(false);
  expect(
    await experienceOwnsProductRoute(
      [{ path: '/pages/story', view: 'editorial' }],
      '/devices/item',
      'item'
    )
  ).toBe(false);
});
it('recognizes declared PDP ownership after the native resolver selected the canonical product path', async () => {
  expect(
    await experienceOwnsProductRoute(
      [{ path: '/products/[handle]', view: 'product' }],
      '/devices/item',
      'item'
    )
  ).toBe(true);
  expect(
    await experienceOwnsProductRoute(
      [{ path: '/products/[handle]', view: 'product' }],
      '/devices/other',
      'item'
    )
  ).toBe(false);
});
