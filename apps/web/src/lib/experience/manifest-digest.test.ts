import { sourceDigest } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { canonicalManifest, digestBytes } from './manifest-digest';

const raw = {
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
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reorderKeys(item)])
    );
  return value;
}
it('keeps upload and build identities identical after JSONB-style key reordering', () => {
  const before = parseExperienceManifest(raw);
  const after = parseExperienceManifest(reorderKeys(raw));
  const expected =
    '2554ce4387785f9caddb3899fc089e6576465ec38b2aad1c9d3a12ff589dff0f';
  expect(digestBytes(canonicalManifest(before))).toBe(expected);
  expect(digestBytes(canonicalManifest(after))).toBe(expected);
  expect(sourceDigest(after)).toBe(expected);
});
