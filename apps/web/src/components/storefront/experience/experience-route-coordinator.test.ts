import { expect, it } from 'vitest';
import { createExperiencePort } from './experience-port';
import { createRouteCoordinator } from './experience-route-coordinator';

it('retains port across same-document routes; rapid transitions discard late data', async () => {
  const initial = {
    epoch: 1,
    routeId: 'home',
    params: {},
    canonicalPath: '/',
    publicDataRevision: '1',
  };
  const routes = createRouteCoordinator(initial);
  const port = createExperiencePort(
    { instanceId: 'i', buildDigest: 'a'.repeat(64), shopperPartition: 'p' },
    () => routes.current(),
    async () => ({ status: 'ok', value: {} })
  );
  const before = port;
  let resolveB!: (s: string) => void;
  const b = routes.transitionRoute(
    '/b',
    () => new Promise<string>((r) => (resolveB = r))
  );
  await routes.transitionRoute('/c', async () => '3');
  resolveB('2');
  await b;
  expect(routes.current().canonicalPath).toBe('/c');
  expect(routes.current().epoch).toBe(3);
  expect(port).toBe(before);
});

it('retains matched dynamic parameters in the committed route state', async () => {
  const routes = createRouteCoordinator({
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: '1',
  });
  expect(
    await routes.transitionRoute(
      '/products/device',
      async () => '2',
      'product',
      { handle: 'device' }
    )
  ).toMatchObject({ routeId: 'product', params: { handle: 'device' } });
});
