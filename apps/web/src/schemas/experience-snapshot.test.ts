import { expect, it } from 'vitest';
import { experienceSnapshotKeySchema } from './experience-snapshot';

it('keys semantic snapshots to supported engines/viewports and an explicit extractor', () => {
  const key = {
    build: 'a'.repeat(64),
    assets: 'b'.repeat(64),
    catalog: 'r',
    path: '/',
  };
  expect(experienceSnapshotKeySchema.parse(key).extractor).toBe('semantic-v1');
  for (const extra of [
    { viewport: '2000' },
    { browser: 'other' },
    { extractor: 'source-authored' },
    { html: '<script>' },
  ])
    expect(
      experienceSnapshotKeySchema.safeParse({ ...key, ...extra }).success
    ).toBe(false);
});
