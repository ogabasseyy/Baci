import { expect, it } from 'vitest';
import { publishedExperienceSchema } from './experience-published';

it('rejects private artifacts and authority fields in a public head', () => {
  const head = {
    merchantId: '11111111-1111-4111-8111-111111111111',
    buildDigest: 'a'.repeat(64),
    version: 1,
    policyRevision: 'p',
    assetsDigest: 'b'.repeat(64),
    routes: [{ path: '/', view: 'home' }],
    capabilities: [],
  };
  expect(publishedExperienceSchema.safeParse(head).success).toBe(true);
  for (const extra of [
    { source: 'private' },
    { ownerToken: 'private' },
    { routes: [{ path: '/', view: 'home', secret: 'private' }] },
  ])
    expect(
      publishedExperienceSchema.safeParse({ ...head, ...extra }).success
    ).toBe(false);
});
