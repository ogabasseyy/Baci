import { describe, expect, it } from 'vitest';
import { advanceRoute } from './route-state';

describe('experience route state', () => {
  it('epoch_is_host_owned and advances without mutating the prior route', () => {
    const old = {
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: 'fixture-1',
    };
    expect(
      advanceRoute(old, {
        routeId: 'product',
        params: { handle: 'device' },
        canonicalPath: '/products/device',
        publicDataRevision: 'fixture-2',
      })
    ).toEqual({
      epoch: 2,
      routeId: 'product',
      params: { handle: 'device' },
      canonicalPath: '/products/device',
      publicDataRevision: 'fixture-2',
    });
    expect(old.epoch).toBe(1);
    expect(() =>
      advanceRoute({ ...old, epoch: Number.MAX_SAFE_INTEGER }, old)
    ).toThrow();
  });
});
