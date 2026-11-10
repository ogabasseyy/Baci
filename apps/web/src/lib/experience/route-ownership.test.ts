import { expect, it } from 'vitest';
import {
  isCategorizedExperienceProductPath,
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
it('matches bounded literal and parameter segments without treating brackets as regex syntax', () => {
  const routes = [
    { path: '/pages/story/[chapter]', view: 'editorial' as const },
    { path: '/pages/a[b]', view: 'editorial' as const },
  ];
  expect(resolveExperienceRoute(routes, '/pages/story/one')).toMatchObject({
    params: { chapter: 'one' },
  });
  expect(resolveExperienceRoute(routes, '/pages/story/one/extra')).toBeNull();
  expect(resolveExperienceRoute(routes, '/pages/a[b]')).toMatchObject({
    params: {},
  });
  expect(resolveExperienceRoute(routes, '/pages/ab')).toBeNull();
  expect(
    resolveExperienceRoute(routes, `/pages/${'a'.repeat(1100)}`)
  ).toBeNull();
});

it.each([
  '/repair/status',
  '/repairs/iphone-15',
  '/auth/login',
  '/compare/phones',
  '/phones/compare',
  '/collections/all',
])('keeps authoritative native families outside categorized product ownership: %s', (path) => {
  expect(isCategorizedExperienceProductPath(path)).toBe(false);
});
it('still admits a genuine categorized product candidate', () => {
  expect(isCategorizedExperienceProductPath('/phones/device')).toBe(true);
});
