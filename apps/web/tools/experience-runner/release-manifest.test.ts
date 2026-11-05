import { expect, it } from 'vitest';
import { buildExperienceReleaseManifest } from './release-manifest';

const h = 'a'.repeat(64);
const names = [
  'unit',
  'types',
  'lint',
  'sql',
  'browser',
  'linux',
  'noAi',
  'review',
  'ciFull',
  'ciTargeted',
];
const input = () => ({
  candidateSha: 'a'.repeat(40),
  sourceDigest: h,
  lockDigest: h,
  toolchainDigest: h,
  runtimeDigest: h,
  rollbackBuild: h,
  gates: Object.fromEntries(
    names.map((n) => [
      n,
      { status: 'passed', sourceDigest: h, evidence: 'local receipt' },
    ])
  ),
});
it('qualifies only one exact committed source with every actual gate passing, without release authority', () => {
  expect(buildExperienceReleaseManifest(input())).toMatchObject({
    qualified: true,
    incomplete: [],
    releaseAuthorized: false,
    publishingAuthorized: false,
  });
  for (const status of ['missing', 'skipped', 'failed']) {
    const v = input();
    v.gates.ciFull.status = status;
    expect(buildExperienceReleaseManifest(v).qualified).toBe(false);
  }
  const stale = input();
  stale.gates.linux.sourceDigest = 'b'.repeat(64);
  expect(buildExperienceReleaseManifest(stale).incomplete).toContain('linux');
  const dirty = { ...input(), candidateSha: null };
  expect(buildExperienceReleaseManifest(dirty).incomplete).toContain(
    'committedCandidate'
  );
});
