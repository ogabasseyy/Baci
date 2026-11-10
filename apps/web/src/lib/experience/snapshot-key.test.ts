// @vitest-environment node
import { expect, it } from 'vitest';
import { snapshotKeyDigest } from './snapshot-key';

it('keys browser/viewport/catalog state exactly and rejects traversal', () => {
  const key = {
    build: 'a'.repeat(64),
    assets: 'b'.repeat(64),
    catalog: 'c',
    path: '/',
    viewport: '390' as const,
  };
  expect(snapshotKeyDigest(key)).toBe(
    snapshotKeyDigest({
      viewport: '390',
      path: '/',
      catalog: 'c',
      assets: key.assets,
      build: key.build,
    })
  );
  expect(snapshotKeyDigest({ ...key, viewport: '1440' })).not.toBe(
    snapshotKeyDigest(key)
  );
  expect(() =>
    snapshotKeyDigest({ ...key, path: '/pages/%2fprivate' })
  ).toThrow('INVALID_ROUTE');
});
