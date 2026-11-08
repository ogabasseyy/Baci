import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadAssetBodies } from './ogabassey-layout-prebuilt-assets';

it('compares captured bytes with prebuilt assets and rejects mismatches', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'layout-assets-'));
  const capture = path.join(root, 'capture');
  const built = path.join(root, 'built');
  await mkdir(capture);
  await mkdir(path.join(built, '_next/static'), { recursive: true });
  await writeFile(path.join(capture, 'a.css'), 'x');
  await writeFile(path.join(built, '_next/static/a.css'), 'x');
  const manifest = {
    version: 1 as const,
    captures: [],
    assets: [{ path: 'a.css', url: '/_next/static/a.css' }],
  };
  expect(
    (await loadAssetBodies(capture, built, manifest)).get('/_next/static/a.css')
  ).toBe('x');
  await writeFile(path.join(built, '_next/static/a.css'), 'y');
  await expect(loadAssetBodies(capture, built, manifest)).rejects.toThrow(
    /differs/
  );
});
