import { expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ state: vi.fn(), renew: vi.fn() }));
vi.mock('./experience-launch-client', () => ({
  readExperiencePublicationState: calls.state,
  renewExperienceLaunch: calls.renew,
  readExperienceCatalog: vi.fn(),
}));

import { createPublishedExperienceHost } from './experience-host-runtime';
import { createExperienceShellController } from './experience-shell-controller';

it('requires an anonymous launch and renews before expiry without changing the execution instance or creating a cart', async () => {
  vi.useFakeTimers();
  try {
    const controller = createExperienceShellController();
    const now = Date.now();
    const data = {
      manifest: {
        buildDigest: 'a'.repeat(64),
        policyRevision: 'p',
        routes: [{ path: '/', view: 'home' }],
      },
      launch: {
        instanceId: 'same-instance',
        buildDigest: 'a'.repeat(64),
        canonicalBase: 'http://localhost/qa1',
        expiresAt: now + 1800000,
      },
      bootstrap: {
        route: { epoch: 1, canonicalPath: '/' },
        catalog: { products: [], revision: 'r' },
      },
      stateUrl: '/api/storefront/experience/state',
    };
    controller.activate('home', data as never);
    calls.state.mockResolvedValue({
      active: true,
      policyRevision: 'p',
      catalogRevision: 'r',
    });
    calls.renew.mockImplementation(async () => ({
      buildDigest: 'a'.repeat(64),
      policyRevision: 'p',
      catalogRevision: 'r',
      expiresAt: Date.now() + 1800000,
    }));
    const live = {
      current: { cart: null, router: { refresh: vi.fn(), push: vi.fn() } },
    };
    const runtime = createPublishedExperienceHost({
      controller,
      live,
      merchantSlug: 'qa1',
      present: vi.fn(),
    });
    expect(runtime.host.current().active).toBe(false);
    expect(await runtime.isActive()).toBe(true);
    expect(calls.renew).toHaveBeenCalledOnce();
    expect(runtime.host.current().binding.instanceId).toBe('same-instance');
    vi.setSystemTime(now + 1790000);
    expect(await runtime.isActive()).toBe(true);
    expect(calls.renew).toHaveBeenCalledTimes(2);
    expect(runtime.host.current().binding.instanceId).toBe('same-instance');
    calls.renew.mockRejectedValue(Error('offline'));
    vi.setSystemTime(now + 3590000);
    expect(await runtime.isActive()).toBe(false);
    expect(controller.getSnapshot()?.active).toBe(false);
    // A state-read withdrawal must not poison a newly verified server launch.
    calls.renew.mockImplementation(async () => ({
      buildDigest: 'a'.repeat(64),
      policyRevision: 'p',
      catalogRevision: 'r',
      expiresAt: Date.now() + 1800000,
    }));
    controller.activate('retry', {
      ...data,
      launch: { ...data.launch, instanceId: 'retry-instance' },
    } as never);
    calls.state.mockResolvedValue({
      active: false,
      policyRevision: 'p',
      catalogRevision: 'r',
    });
    expect(await runtime.isActive()).toBe(false);
    controller.activate('fresh', {
      ...data,
      launch: { ...data.launch, instanceId: 'fresh-instance' },
    } as never);
    calls.state.mockResolvedValue({
      active: true,
      policyRevision: 'p',
      catalogRevision: 'r',
    });
    expect(await runtime.isActive()).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('completes authored product navigation at the trusted catalog canonical destination', async () => {
  const controller = createExperienceShellController();
  const data = {
    manifest: {
      buildDigest: 'a'.repeat(64),
      policyRevision: 'p',
      routes: [{ path: '/products/[handle]', view: 'product' }],
    },
    launch: {
      instanceId: 'canonical-test',
      canonicalBase: 'http://localhost/qa1',
    },
    bootstrap: {
      route: { epoch: 1, canonicalPath: '/' },
      catalog: {
        revision: 'r',
        products: [
          {
            slug: 'synthetic-device',
            canonicalPath: '/phones/synthetic-device',
          },
        ],
      },
    },
  };
  controller.activate('home', data as never);
  const push = vi.fn(() =>
    controller.activate('product', {
      ...data,
      bootstrap: {
        ...data.bootstrap,
        route: { epoch: 2, canonicalPath: '/phones/synthetic-device' },
      },
    } as never)
  );
  const runtime = createPublishedExperienceHost({
    controller,
    live: { current: { cart: null, router: { refresh: vi.fn(), push } } },
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  await expect(
    runtime.host.navigate('/products/synthetic-device')
  ).resolves.toMatchObject({ canonicalPath: '/phones/synthetic-device' });
  expect(push).toHaveBeenCalledWith('/qa1/phones/synthetic-device');
  expect(controller.getSnapshot()?.active).toBe(true);
  await expect(runtime.host.navigate('/admin')).rejects.toThrow(
    'INVALID_ROUTE'
  );
});

it('bounds refreshes when consecutive server launches fail publication admission, then rearms after verified recovery', async () => {
  calls.state.mockResolvedValue({ active: false });
  calls.renew.mockResolvedValue({
    buildDigest: 'a'.repeat(64),
    policyRevision: 'p',
    catalogRevision: 'r',
    expiresAt: Date.now() + 1800000,
  });
  const controller = createExperienceShellController();
  const refresh = vi.fn();
  const runtime = createPublishedExperienceHost({
    controller,
    live: { current: { cart: null, router: { refresh, push: vi.fn() } } },
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  const activate = (instanceId: string) =>
    controller.activate(instanceId, {
      manifest: {
        buildDigest: 'a'.repeat(64),
        policyRevision: 'p',
        routes: [{ path: '/', view: 'home' }],
      },
      launch: {
        instanceId,
        buildDigest: 'a'.repeat(64),
        canonicalBase: 'http://localhost/qa1',
        expiresAt: Date.now() + 1800000,
      },
      bootstrap: {
        route: { epoch: 1, canonicalPath: '/' },
        catalog: { products: [], revision: 'r' },
      },
      stateUrl: '/api/storefront/experience/state',
    } as never);
  for (const id of ['first', 'second', 'third']) {
    activate(id);
    expect(await runtime.isActive()).toBe(false);
    expect(controller.getSnapshot()?.active).toBe(false);
  }
  expect(refresh).toHaveBeenCalledOnce();
  calls.state.mockResolvedValue({
    active: true,
    policyRevision: 'p',
    catalogRevision: 'r',
  });
  activate('recovered');
  expect(await runtime.isActive()).toBe(true);
  calls.state.mockResolvedValue({ active: false });
  activate('withdrawn-again');
  expect(await runtime.isActive()).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(2);
});
