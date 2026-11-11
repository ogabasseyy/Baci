import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

import { createLocalPrerenderArtifacts } from './prerender-artifacts';

const digest = (js: string) =>
  createHash('sha256').update(`${js}\0`).digest('hex');
const binding = {
  merchantId: 'merchant',
  buildId: 'build',
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
};
const renderer = {
  javascript: 'export{}',
  css: '',
  digest: digest('export{}'),
  imports: ['source:__baci_prerender__.tsx'],
};
it('retains exact merchant/build/source renderer bytes beyond a preview lease and rejects tenant/source/build drift', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
  const store = createLocalPrerenderArtifacts();
  store.retain({ ...binding, renderer });
  expect(store.read(binding).javascript).toBe(renderer.javascript);
  for (const key of ['merchantId', 'buildId', 'buildDigest', 'sourceDigest'])
    expect(() => store.read({ ...binding, [key]: 'different' })).toThrow(
      'OUTPUT_NOT_RETAINED'
    );
  vi.setSystemTime(600001);
  expect(store.read(binding).javascript).toBe(renderer.javascript);
});
it('rejects corrupt renderer output and refuses conflicting immutable retention', () => {
  const store = createLocalPrerenderArtifacts();
  expect(() =>
    store.retain({
      ...binding,
      renderer: { ...renderer, digest: 'c'.repeat(64) },
    })
  ).toThrow('BUILD_FAILED');
  store.retain({ ...binding, renderer });
  const javascript = 'export const changed=true';
  expect(() =>
    store.retain({
      ...binding,
      renderer: { ...renderer, javascript, digest: digest(javascript) },
    })
  ).toThrow('BUILD_FAILED');
});

it('evicts least recently used companion output at the bounded entry quota', () => {
  const store = createLocalPrerenderArtifacts();
  for (let index = 0; index < 32; index++)
    store.retain({ ...binding, buildId: `build-${index}`, renderer });
  expect(store.read({ ...binding, buildId: 'build-0' }).javascript).toBe(
    renderer.javascript
  );
  store.retain({ ...binding, buildId: 'build-32', renderer });
  expect(() => store.read({ ...binding, buildId: 'build-1' })).toThrow(
    'OUTPUT_NOT_RETAINED'
  );
  expect(store.read({ ...binding, buildId: 'build-0' }).javascript).toBe(
    renderer.javascript
  );
});

it('evicts companion output at the serialized-byte budget before reaching the entry limit', () => {
  const store = createLocalPrerenderArtifacts();
  const javascript = `//${'x'.repeat(3 * 1024 * 1024)}`;
  const large = {
    javascript,
    css: '',
    digest: digest(javascript),
    imports: [],
  };
  for (let index = 0; index < 24; index++)
    store.retain({ ...binding, buildId: `large-${index}`, renderer: large });
  expect(() => store.read({ ...binding, buildId: 'large-0' })).toThrow(
    'OUTPUT_NOT_RETAINED'
  );
  expect(store.read({ ...binding, buildId: 'large-23' }).digest).toBe(
    large.digest
  );
});

it('keeps delimiter-containing merchant/build tuples isolated', () => {
  const store = createLocalPrerenderArtifacts();
  const first = { ...binding, merchantId: 'a', buildId: 'b:c' };
  const second = { ...binding, merchantId: 'a:b', buildId: 'c' };
  store.retain({ ...first, renderer });
  expect(() => store.read(second)).toThrow('OUTPUT_NOT_RETAINED');
  const javascript = 'export const isolated=true';
  const otherRenderer = { ...renderer, javascript, digest: digest(javascript) };
  store.retain({ ...second, renderer: otherRenderer });
  expect(store.read(first).digest).toBe(renderer.digest);
  expect(store.read(second).digest).toBe(otherRenderer.digest);
});
