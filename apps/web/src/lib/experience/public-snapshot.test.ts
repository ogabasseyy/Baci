// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { loadPublicSnapshot } from './public-snapshot';

const key = {
  build: 'a'.repeat(64),
  assets: 'b'.repeat(64),
  catalog: 'current',
  path: '/',
};
it('requires current catalog/publication both before and after a semantic read', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      key,
      consumesCatalog: true,
      nodes: [{ tag: 'h1', children: [{ text: 'Public story' }] }],
    },
    error: null,
  });
  const client = { rpc };
  expect(
    await loadPublicSnapshot(client as never, 'qa1', key, async () => true)
  ).toMatchObject({ nodes: [{ tag: 'h1' }] });
  let call = 0;
  expect(
    await loadPublicSnapshot(
      client as never,
      'qa1',
      key,
      async () => ++call === 1
    )
  ).toBeNull();
  rpc.mockResolvedValue({
    data: {
      key: { ...key, catalog: 'old' },
      consumesCatalog: true,
      nodes: [{ text: 'Old price' }],
    },
    error: null,
  });
  expect(
    await loadPublicSnapshot(client as never, 'qa1', key, async () => true)
  ).toBeNull();
});
