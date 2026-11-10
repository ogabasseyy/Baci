// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { readPublishedResource } from './published-resource';

it('checks current merchant/build and exact immutable file hashes for every read', async () => {
  let current = true;
  const bytes = Buffer.from('export{}');
  const read = vi.fn(async () => ({
    path: 'app.js',
    mime: 'text/javascript',
    digest: digestBytes(bytes),
    bytes,
  }));
  const deps = {
    current: async (slug: string, digest: string) =>
      current && slug === 'qa1' && digest === 'a'.repeat(64),
    read,
  };
  expect(
    await readPublishedResource('qa1', 'a'.repeat(64), 'app.js', deps)
  ).toMatchObject({ digest: digestBytes(bytes) });
  current = false;
  expect(
    await readPublishedResource('qa1', 'a'.repeat(64), 'app.js', deps)
  ).toBeNull();
  for (const path of [
    '../app.js',
    'app.js.map',
    'assets/%2e%2e/source.tsx',
    'private/source.tsx',
  ])
    expect(
      await readPublishedResource('qa1', 'a'.repeat(64), path, deps)
    ).toBeNull();
  expect(read).toHaveBeenCalledOnce();
});
