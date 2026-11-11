import { expect, it, vi } from 'vitest';
import { createPublishedExperienceHost } from './experience-host-runtime';
import { createExperienceShellController } from './experience-shell-controller';

it.each([
  { current: '/', requested: '/' },
  {
    current: '/phones/synthetic-device',
    requested: '/phones/synthetic-device',
  },
  {
    current: '/phones/synthetic-device',
    requested: '/products/synthetic-device',
  },
])('keeps an active storefront when navigating to its current canonical route: $requested', async ({
  current,
  requested,
}) => {
  vi.useFakeTimers();
  try {
    const controller = createExperienceShellController();
    const route = { epoch: 7, canonicalPath: current };
    controller.activate('current-route', {
      manifest: {
        buildDigest: 'a'.repeat(64),
        policyRevision: 'synthetic',
        routes: [
          { path: '/', view: 'home' },
          { path: '/products/[handle]', view: 'product' },
        ],
      },
      launch: {
        instanceId: 'same-route-test',
        canonicalBase: 'http://localhost/qa1',
      },
      bootstrap: {
        route,
        catalog: {
          revision: 'synthetic',
          products: [
            {
              slug: 'synthetic-device',
              canonicalPath: '/phones/synthetic-device',
            },
          ],
        },
      },
    } as never);
    const activeRoute = controller.getSnapshot()?.data.bootstrap.route;
    const push = vi.fn();
    const runtime = createPublishedExperienceHost({
      controller,
      live: { current: { cart: null, router: { push, refresh: vi.fn() } } },
      merchantSlug: 'qa1',
      present: vi.fn(),
    });
    const settled = runtime.host.navigate(requested).then(
      (value) => ({ value, error: null }),
      (error: Error) => ({ value: null, error: error.message })
    );
    await vi.advanceTimersByTimeAsync(8001);
    expect(await settled).toEqual({ value: activeRoute, error: null });
    expect(push).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      active: true,
      transitioning: false,
    });
  } finally {
    vi.useRealTimers();
  }
});

it('hands known native products to Baci navigation without waiting for an experience boundary', async () => {
  vi.useFakeTimers();
  try {
    const controller = createExperienceShellController();
    controller.activate('home', {
      manifest: { routes: [{ path: '/', view: 'home' }] },
      launch: { canonicalBase: 'http://localhost/qa1' },
      bootstrap: {
        route: { epoch: 1, canonicalPath: '/' },
        catalog: {
          products: [{ slug: 'device', canonicalPath: '/phones/device' }],
        },
      },
    } as never);
    const push = vi.fn();
    const runtime = createPublishedExperienceHost({
      controller,
      live: { current: { cart: null, router: { push, refresh: vi.fn() } } },
      merchantSlug: 'qa1',
      present: vi.fn(),
    });
    const result = runtime.host.navigate('/phones/device').then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: error.message })
    );
    await vi.advanceTimersByTimeAsync(8001);
    expect(await result).toMatchObject({
      value: { canonicalPath: '/phones/device' },
      error: null,
    });
    expect(push).toHaveBeenCalledWith('/qa1/phones/device');
    expect(controller.getSnapshot()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
