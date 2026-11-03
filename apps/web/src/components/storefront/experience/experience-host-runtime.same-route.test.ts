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
