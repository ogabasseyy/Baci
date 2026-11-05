import { createHash } from 'node:crypto';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const gate = z.strictObject({
  status: z.enum(['passed', 'failed', 'missing', 'skipped']),
  sourceDigest: hash,
  evidence: z.string().min(1).max(1000),
});
export const releaseManifestInput = z.strictObject({
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  sourceDigest: hash,
  lockDigest: hash,
  toolchainDigest: hash,
  runtimeDigest: hash,
  rollbackBuild: hash.nullable(),
  gates: z.strictObject({
    unit: gate,
    types: gate,
    lint: gate,
    sql: gate,
    browser: gate,
    linux: gate,
    noAi: gate,
    review: gate,
    ciFull: gate,
    ciTargeted: gate,
  }),
});
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
