import { expect, it } from 'vitest';
import { createExperienceShellController } from './experience-shell-controller';

it('keeps one execution instance across same-build route updates and retires it at checkout', () => {
  const controller = createExperienceShellController();
  const data = {
    manifest: {
      merchantId: 'm',
      buildDigest: 'b',
      version: 1,
      policyRevision: 'p',
      assetsDigest: 'a',
      routes: [],
      capabilities: [],
    },
    launch: {
      instanceId: 'i',
      buildDigest: 'b',
      expiresAt: Date.now() + 60000,
      bootstrap: {},
      routes: [],
      canonicalBase: 'http://localhost/qa1',
      src: 'http://localhost:4101/app',
      nonce: 'n',
    },
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        params: {},
        canonicalPath: '/',
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
    stateUrl: '/api/storefront/experience/state',
    title: 'Home',
    canonicalUrl: 'http://localhost/qa1',
  };
  controller.activate('home', data as never);
  const first = controller.getSnapshot();
  controller.activate('pdp', {
    ...data,
    bootstrap: {
      ...data.bootstrap,
      route: { ...data.bootstrap.route, canonicalPath: '/products/phone' },
    },
  } as never);
  expect(controller.getSnapshot()?.data.launch).toBe(first?.data.launch);
  expect(controller.getSnapshot()?.data.bootstrap.route.epoch).toBe(2);
  controller.exit();
  expect(controller.getSnapshot()).toBeNull();
});
it('does not expose cached prices as fallback after freshness authority is withdrawn', () => {
  const controller = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { expiresAt: Date.now() + 10000 },
    bootstrap: { route: { epoch: 1 } },
  };
  controller.activate('route', data as never);
  controller.withdraw();
  expect(controller.getSnapshot()).toMatchObject({
    active: false,
    fallbackFresh: false,
  });
});
it('a StrictMode cleanup cannot clear a newer activation of the same route lease', async () => {
  const c = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { expiresAt: Date.now() + 10000 },
    bootstrap: { route: { epoch: 1 } },
  };
  c.activate('same', data as never);
  c.release('same');
  c.activate('same', data as never);
  await Promise.resolve();
  expect(c.getSnapshot()?.active).toBe(true);
});
it('keeps fallback until the current instance connects, ignoring retired ready signals', () => {
  const c = createExperienceShellController();
  const data = (build: string, instanceId: string) => ({
    manifest: { buildDigest: build, policyRevision: 'p' },
    launch: { instanceId, expiresAt: Date.now() + 10000 },
    bootstrap: { route: { epoch: 1 } },
  });
  c.activate('a', data('a', 'one') as never);
  expect(c.getSnapshot()?.ready).toBe(false);
  c.markReady('one');
  expect(c.getSnapshot()?.ready).toBe(true);
  c.activate('b', data('b', 'two') as never);
  c.markReady('one');
  expect(c.getSnapshot()?.ready).toBe(false);
  c.markReady('two');
  expect(c.getSnapshot()?.ready).toBe(true);
  c.withdraw();
  c.markReady('two');
  expect(c.getSnapshot()?.active).toBe(false);
});
it('retains the execution document while route boundaries settle, but suspends effects', async () => {
  const c = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { instanceId: 'i' },
    bootstrap: { route: { epoch: 1 } },
  };
  c.activate('old', data as never);
  c.markReady('i');
  c.beginTransition();
  c.release('old');
  await Promise.resolve();
  expect(c.getSnapshot()).toMatchObject({
    active: true,
    ready: true,
    transitioning: true,
  });
  c.activate('next', data as never);
  expect(c.getSnapshot()).toMatchObject({
    active: true,
    ready: true,
    transitioning: false,
  });
});
it('requires a newly verified server launch to resume after freshness withdrawal', () => {
  const c = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { instanceId: 'one' },
    bootstrap: { route: { epoch: 1 }, catalog: { revision: 'old' } },
  };
  c.activate('old', data as never);
  c.withdraw();
  c.activate('stale', data as never);
  expect(c.getSnapshot()?.active).toBe(false);
  c.activate('fresh', {
    ...data,
    launch: { instanceId: 'two' },
    bootstrap: { ...data.bootstrap, catalog: { revision: 'new' } },
  } as never);
  expect(c.getSnapshot()).toMatchObject({
    active: true,
    ready: false,
    data: { launch: { instanceId: 'two' } },
  });
});
