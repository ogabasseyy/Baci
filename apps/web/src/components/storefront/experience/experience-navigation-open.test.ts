import { expect, it } from 'vitest';
import { createNavigationPresentation } from './experience-navigation-open';

it('presents one host canonical link, same replay converges; encoded/external/reserved paths denied', () => {
  let state = {
    epoch: 1,
    instanceId: 'i',
    shopperPartition: 'p',
    transition: false,
    active: true,
  };
  const nav = createNavigationPresentation({
    base: 'http://127.0.0.1:4100/qa1',
    routes: [
      '/',
      '/products/[slug]',
      '/collections/[handle]',
      '/journal/[slug]',
    ],
    state: () => state,
    now: () => 1000,
  });
  const a = nav.presentCanonicalLink({
    requestId: 'r',
    path: '/products/device',
  });
  expect(a.href).toBe('http://127.0.0.1:4100/qa1/products/device');
  expect(
    nav.presentCanonicalLink({ requestId: 'r', path: '/products/device' })
  ).toBe(a);
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/%2f/evil',
    '/checkout',
    '/../admin',
  ])
    expect(() =>
      nav.presentCanonicalLink({ requestId: 'evil', path })
    ).toThrow();
  expect(() =>
    nav.presentCanonicalLink({ requestId: 'r', path: '/journal/other' })
  ).toThrow('IDEMPOTENCY_CONFLICT');
  state = { ...state, transition: true };
  expect(nav.current()).toBeNull();
  expect(() =>
    nav.presentCanonicalLink({ requestId: 's', path: '/products/device' })
  ).toThrow('ROUTE_TRANSITION');
});

it('does not permanently exhaust link presentation after completed presentations', () => {
  let now = 1000;
  const nav = createNavigationPresentation({
    base: 'http://127.0.0.1:4100/qa1',
    routes: ['/'],
    state: () => ({
      epoch: 1,
      instanceId: 'i',
      shopperPartition: 'p',
      transition: false,
      active: true,
    }),
    now: () => now,
  });
  for (let n = 0; n < 300; n++) {
    expect(
      nav.presentCanonicalLink({ requestId: `link-${n}`, path: '/' }).href
    ).toBe('http://127.0.0.1:4100/qa1/');
    nav.cancel();
    now += 1000;
  }
});
