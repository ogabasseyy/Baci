import { expect, it } from 'vitest';
import {
  experienceJobTicket,
  releaseManifestInput,
} from './experience-runner-proofs';

const digest = 'a'.repeat(64);
const ticket = {
  jobId: 'synthetic-job',
  sourceDigest: digest,
  attemptNonce: 'attempt',
  audience: 'experience-output',
  toolchainDigest: digest,
  expiresAt: 1,
  maxBytes: 16777216,
};
it('validates output-ticket purpose and budget without changing the signed field order', () => {
  expect(JSON.stringify(experienceJobTicket.parse(ticket))).toBe(
    JSON.stringify(ticket)
  );
  for (const patch of [
    { audience: 'other' },
    { maxBytes: 16777217 },
    { expiresAt: 0 },
    { attemptNonce: '' },
    { sourceDigest: 'bad' },
    { sandboxKey: 'extra' },
  ]) {
    expect(experienceJobTicket.safeParse({ ...ticket, ...patch }).success).toBe(
      false
    );
  }
});
it('requires explicit release gates and permits an uncommitted candidate to be represented', () => {
  const gate = { status: 'missing', sourceDigest: digest, evidence: 'pending' };
  const gates = {
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
  };
  const manifest = {
    candidateSha: null,
    sourceDigest: digest,
    lockDigest: digest,
    toolchainDigest: digest,
    runtimeDigest: digest,
    rollbackBuild: null,
    gates,
  };
  expect(releaseManifestInput.parse(manifest)).toEqual(manifest);
  expect(
    releaseManifestInput.safeParse({ ...manifest, candidateSha: 'bad' }).success
  ).toBe(false);
  expect(
    releaseManifestInput.safeParse({
      ...manifest,
      gates: { ...gates, ciFull: undefined },
    }).success
  ).toBe(false);
  expect(
    releaseManifestInput.safeParse({
      ...manifest,
      gates: { ...gates, review: { ...gate, status: 'approved' } },
    }).success
  ).toBe(false);
});
