import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import { experienceSourceHeadRow } from './experience-source-head';

const row = {
  artifact_id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  artifact: {
    source_digest: 'a'.repeat(64),
    entry: 'app.tsx',
    files: [{ path: 'app.tsx' }],
  },
};

it('parses the source-head projection', () => {
  expect(experienceSourceHeadRow.parse(row)).toEqual(row);
});

it('rejects invalid head metadata and incomplete artifact projections', () => {
  for (const patch of [
    { artifact_id: 'bad' },
    { version: 0 },
    { version: 1.5 },
    { artifact: null },
    { artifact: { ...row.artifact, source_digest: 'bad' } },
    { artifact: { ...row.artifact, entry: '../app.tsx' } },
    { artifact: { ...row.artifact, files: [] } },
    {
      artifact: {
        ...row.artifact,
        files: Array.from({ length: EXPERIENCE_LIMITS.files + 1 }, (_, i) => ({
          path: `file-${i}.tsx`,
        })),
      },
    },
    {
      artifact: { ...row.artifact, files: [{ path: 'app.tsx', content: '' }] },
    },
  ]) {
    expect(
      experienceSourceHeadRow.safeParse({ ...row, ...patch }).success
    ).toBe(false);
  }
});
