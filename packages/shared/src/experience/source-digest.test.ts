import { expect, it } from 'vitest';
import { sourceDigest } from './source-digest';
import type { ExperienceManifest } from './types';

const manifest: ExperienceManifest = {
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'app.tsx',
  files: [
    { path: 'style.css', content: '' },
    { path: 'app.tsx', content: 'export default null;' },
  ],
  packages: [],
  routes: [{ path: '/', view: 'home' }],
  assets: [],
  capabilities: ['navigation'],
};
const expected =
  '2554ce4387785f9caddb3899fc089e6576465ec38b2aad1c9d3a12ff589dff0f';
it('retains the reviewed source identity vector', () => {
  expect(sourceDigest(manifest)).toBe(expected);
});
it('ignores only source-file listing order without mutating the caller', () => {
  expect(
    sourceDigest({ ...manifest, files: [...manifest.files].reverse() })
  ).toBe(expected);
  expect(manifest.files.map((file) => file.path)).toEqual([
    'style.css',
    'app.tsx',
  ]);
});
it('changes identity when source bytes change', () => {
  expect(
    sourceDigest({
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === 'app.tsx'
          ? { ...file, content: 'export default 1;' }
          : file
      ),
    })
  ).not.toBe(expected);
});

it.each([
  ['entry', { ...manifest, entry: 'other.tsx' }],
  ['capabilities', { ...manifest, capabilities: [] }],
  [
    'file path',
    {
      ...manifest,
      files: manifest.files.map((file) => ({
        ...file,
        path: `new/${file.path}`,
      })),
    },
  ],
  [
    'packages',
    {
      ...manifest,
      packages: [{ name: 'react', versionRef: 'platform-pinned' }],
    },
  ],
] satisfies [
  string,
  ExperienceManifest,
][])('includes %s in the source identity', (_name, changed) => {
  expect(sourceDigest(changed)).not.toBe(expected);
});
it('preserves route ordering in the source identity', () => {
  const routes: ExperienceManifest['routes'] = [
    { path: '/', view: 'home' },
    { path: '/pages/about', view: 'editorial' },
  ];
  expect(sourceDigest({ ...manifest, routes })).not.toBe(
    sourceDigest({ ...manifest, routes: [...routes].reverse() })
  );
});
