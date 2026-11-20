import { expect, it } from 'vitest';
import { selectInitialExperienceView } from './local-prerender-pipeline';

it('uses a non-product route for initial build bootstrap when product is listed first', () => {
  expect(
    selectInitialExperienceView([
      { path: '/products/[handle]', view: 'product' },
      { path: '/', view: 'home' },
    ])
  ).toBe('home');
  expect(
    selectInitialExperienceView([
      { path: '/products/[handle]', view: 'product' },
      { path: '/collections/[handle]', view: 'collection' },
    ])
  ).toBe('collection');
  expect(
    selectInitialExperienceView([
      { path: '/products/[handle]', view: 'product' },
    ])
  ).toBe('product');
});
