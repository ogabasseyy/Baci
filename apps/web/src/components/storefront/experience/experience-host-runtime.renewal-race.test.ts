import { expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ state: vi.fn(), renew: vi.fn() }));
vi.mock('./experience-launch-client', () => ({
  readExperiencePublicationState: calls.state,
  renewExperienceLaunch: calls.renew,
}));

import { createPublishedExperienceHost } from './experience-host-runtime';
import { createExperienceShellController } from './experience-shell-controller';

it('renews a replacement instance independently and ignores the retired renewal result', async () => {
  const response = {
    buildDigest: 'a'.repeat(64),
    policyRevision: 'synthetic',
    catalogRevision: 'synthetic',
    expiresAt: Date.now() + 1800000,
  };
  let finishOld: (value: typeof response) => void = () => {
    throw Error('Old renewal did not start');
  };
  calls.state.mockResolvedValue({
    active: true,
    policyRevision: 'synthetic',
    catalogRevision: 'synthetic',
  });
  calls.renew
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce(response);
  const controller = createExperienceShellController();
  const activate = (instanceId: string) =>
    controller.activate(instanceId, {
      manifest: {
        buildDigest: response.buildDigest,
        policyRevision: 'synthetic',
        routes: [{ path: '/', view: 'home' }],
      },
      launch: { instanceId, canonicalBase: 'http://localhost/qa1' },
      bootstrap: {
        route: { epoch: 1, canonicalPath: '/' },
        catalog: { products: [], revision: 'synthetic' },
      },
      stateUrl: '/api/storefront/experience/state',
    } as never);
  activate('retired-instance');
  const runtime = createPublishedExperienceHost({
    controller,
    live: {
      current: { cart: null, router: { refresh: vi.fn(), push: vi.fn() } },
    },
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  const old = runtime.isActive();
  await vi.waitFor(() => expect(calls.renew).toHaveBeenCalledTimes(1));
  controller.withdraw();
  activate('replacement-instance');
  const replacement = runtime.isActive();
  try {
    await vi.waitFor(() => expect(calls.renew).toHaveBeenCalledTimes(2));
    expect(await replacement).toBe(true);
  } finally {
    finishOld(response);
  }
  expect(await old).toBe(false);
  expect(controller.getSnapshot()?.active).toBe(true);
  expect(runtime.host.current()).toMatchObject({
    active: true,
    binding: { instanceId: 'replacement-instance' },
  });
});
