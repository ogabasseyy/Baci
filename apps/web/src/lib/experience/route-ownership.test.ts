import { expect, it } from 'vitest';
import {
  resolveExperienceRoute,
  validateExperienceRoutes,
} from './route-ownership';

it('rejects native static pages, decoded separators and duplicate effective paths', () => {
  for (const path of [
    '/pages/about',
    '/checkout',
    '/pages/a%2fb',
    '/account',
    '/pages/%61bout',
  ])
    expect(() =>
      validateExperienceRoutes([{ path, view: 'editorial' }])
    ).toThrow();
  expect(() =>
    validateExperienceRoutes([
      { path: '/pages/[slug]', view: 'editorial' },
      { path: '/pages/[name]', view: 'editorial' },
    ])
  ).toThrow();
});
it('accepts nonconflicting editorial routes and preserves canonical product decisions', () => {
  const routes = validateExperienceRoutes([
    { path: '/', view: 'home' },
    { path: '/products/[handle]', view: 'product' },
    { path: '/pages/story', view: 'editorial' },
  ]);
  expect(resolveExperienceRoute(routes, '/pages/story')).toMatchObject({
    view: 'editorial',
    params: {},
  });
  expect(resolveExperienceRoute(routes, '/checkout')).toBeNull();
});
