import { expect, it } from 'vitest';
import {
  loadPublishedExperience,
  parsePublishedExperience,
} from './published-manifest';

it('defaults to the native engine without installing public runtime', async () => {
  expect(
    await loadPublishedExperience({
      id: '10000000-0000-4000-8000-000000000001',
      slug: 'qa1',
    })
  ).toBeNull();
});
it('rejects source/private fields and reserved route claims in public metadata', () => {
  const value = {
    merchantId: '10000000-0000-4000-8000-000000000001',
    buildDigest: 'a'.repeat(64),
    version: 1,
    policyRevision: '1',
    routes: [{ path: '/', view: 'home' }],
    capabilities: ['catalog.read'],
    assetsDigest: 'b'.repeat(64),
  };
  expect(parsePublishedExperience(value).routes).toHaveLength(1);
  expect(() =>
    parsePublishedExperience({ ...value, files: [{ content: 'private' }] })
  ).toThrow();
  expect(() =>
    parsePublishedExperience({
      ...value,
      routes: [{ path: '/pages/about', view: 'editorial' }],
    })
  ).toThrow();
});
