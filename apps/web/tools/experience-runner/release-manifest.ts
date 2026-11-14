import { createHash } from 'node:crypto';
import { releaseManifestInput } from '../../src/schemas/experience-runner-proofs';

export { releaseManifestInput } from '../../src/schemas/experience-runner-proofs';

/** Evidence, never deployment/publication authority. Missing/skipped/stale gates fail. */
export function buildExperienceReleaseManifest(input: unknown) {
  const v = releaseManifestInput.parse(input);
  const incomplete = Object.entries(v.gates)
    .filter(
      ([, g]) => g.status !== 'passed' || g.sourceDigest !== v.sourceDigest
    )
    .map(([n]) => n);
  if (!v.candidateSha) incomplete.push('committedCandidate');
  if (!v.rollbackBuild) incomplete.push('compatibleRollback');
  const content = {
    ...v,
    qualified: incomplete.length === 0,
    incomplete,
    releaseAuthorized: false,
    publishingAuthorized: false,
    ordersAuthorized: false,
    paymentsAuthorized: false,
  };
  return {
    ...content,
    digest: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  };
}
