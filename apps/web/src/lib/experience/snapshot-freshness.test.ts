import { expect, it, vi } from 'vitest';
import { loadFreshSnapshot } from './snapshot-freshness';

it('requires the exact catalog revision for every catalog consumer and falls back on unknown revision', async () => {
  const refresh = vi.fn();
  const snapshot = {
    key: {
      build: 'b'.repeat(64),
      assets: 'a'.repeat(64),
      catalog: 'old',
      path: '/',
    },
    consumesCatalog: true,
    nodes: [{ text: 'Old price' }],
  };
  expect(
    await loadFreshSnapshot(
      snapshot,
      {
        build: 'b'.repeat(64),
        assets: 'a'.repeat(64),
        catalog: 'new',
        path: '/',
      },
      refresh
    )
  ).toBeNull();
  expect(refresh).toHaveBeenCalledOnce();
  expect(
    await loadFreshSnapshot(
      {
        ...snapshot,
        consumesCatalog: false,
        key: { ...snapshot.key, catalog: null },
      },
      {
        build: 'b'.repeat(64),
        assets: 'a'.repeat(64),
        catalog: null,
        path: '/',
      },
      refresh
    )
  ).not.toBeNull();
  expect(
    await loadFreshSnapshot(
      { ...snapshot, key: { ...snapshot.key, catalog: null } },
      {
        build: 'b'.repeat(64),
        assets: 'a'.repeat(64),
        catalog: null,
        path: '/',
      },
      refresh
    )
  ).toBeNull();
});
