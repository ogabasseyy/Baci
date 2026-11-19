import { expect, it, vi } from 'vitest';

vi.mock('./shared-cart-session-revoke-client', () => ({
  ensureCartDeviceRevocationCleared: async () => true,
}));

import { createExperiencePortForCart } from './shared-cart-experience-runtime';

it('rechecks generation and current snapshot after continuity instead of exposing a captured old cart', async () => {
  let release: (v: Response) => void = () => {};
  let started: () => void = () => {};
  const fetching = new Promise<void>((r) => {
    started = r;
  });
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((r) => {
        release = r;
        started();
      })
  );
  const runtime = {
    generationRef: { current: 1 },
    sessionGeneration: 1,
    enabled: true,
    stateRef: {
      current: {
        cartId: 'c',
        confirmed: {
          version: 1,
          lines: [],
          totalMinor: 10000,
          currency: 'NGN',
        },
      },
    },
    optionsRef: { current: { merchantSlug: 'qa1' } },
    experienceEntriesRef: { current: new Map() },
    dispatch: vi.fn(),
  };
  const port = createExperiencePortForCart(runtime as never);
  const r = port.readPublic('NGN');
  await fetching;
  runtime.stateRef.current.confirmed = {
    version: 2,
    lines: [],
    totalMinor: 25000,
    currency: 'NGN',
  };
  release(Response.json({ fingerprint: 'a'.repeat(64) }));
  expect(await r).toMatchObject({
    status: 'ok',
    value: { version: 2, total: 250 },
  });
  vi.unstubAllGlobals();
});
