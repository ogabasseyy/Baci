// @vitest-environment node
import { expect, it } from 'vitest';
import { readPublishedExperienceState } from './published-state';

it('withdraws on changed build, missing current catalog or enrollment and exposes only public revisions', () => {
  const head = {
    buildDigest: 'a'.repeat(64),
    policyRevision: '2',
    routes: [{ path: '/', view: 'home' }],
    capabilities: ['cart.mutate'],
    ownerId: 'PRIVATE',
  };
  const input = {
    head: head as never,
    catalog: { products: [], revision: 'current' },
    enrolled: true,
    requestedBuild: head.buildDigest,
  };
  const active = readPublishedExperienceState(input);
  expect(active.status).toBe('active');
  expect(JSON.stringify(active)).not.toContain('PRIVATE');
  expect(
    readPublishedExperienceState({ ...input, enrolled: false })
  ).toMatchObject({ active: false, status: 'unavailable' });
  expect(readPublishedExperienceState({ ...input, head: null })).toMatchObject({
    active: false,
    status: 'unpublished',
    buildDigest: null,
  });
  expect(
    readPublishedExperienceState({ ...input, requestedBuild: 'b'.repeat(64) })
      .active
  ).toBe(false);
  expect(readPublishedExperienceState({ ...input, catalog: null }).active).toBe(
    false
  );
});
