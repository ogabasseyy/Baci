import assert from 'node:assert/strict';
import test from 'node:test';

import { checkedTask9Identity } from './task9-bootstrap-identity.mjs';

const sha40 = 'a'.repeat(40);
const sha64 = 'b'.repeat(64);
const digest = 'c'.repeat(64);
const manifest = {
  baseSha: sha40,
  mergeSha: 'd'.repeat(40),
  prNumber: 3302,
  reviewedHeadSha: 'e'.repeat(40),
};
const policy = { repository: { id: 123, name: 'ogabasseyy/Baci' } };
const input = {
  admissionId: digest,
  deploymentSha: manifest.mergeSha,
  headRef: 'feature/task9',
  workflowId: 42,
  reviewedPrMetadataSha256: digest,
};
const metadata = {
  baseSha: manifest.baseSha,
  headRef: input.headRef,
  mergeSha: manifest.mergeSha,
  number: manifest.prNumber,
  reviewedHeadSha: manifest.reviewedHeadSha,
  workflowId: input.workflowId,
};
input.authorityReceipt = {
  coherence: 'success',
  deploymentSha: manifest.mergeSha,
  metadataSha256: digest,
  repository: policy.repository,
  status: 'success',
  workflow: {
    id: input.workflowId,
    path: '.github/workflows/deploy.yml',
    sha: manifest.mergeSha,
  },
};

test('accepts a preserved SHA-1 PR identity with a valid ref', () => {
  const result = checkedTask9Identity(input, manifest, policy, metadata);
  assert.equal(result.mergeSha, manifest.mergeSha);
  assert.equal(result.pullRequest.headRef, 'feature/task9');
});

test('rejects malformed repository and authority fields', () => {
  for (const invalid of [
    { ...input, deploymentSha: sha40 },
    { ...input, deploymentSha: sha64 },
    { ...input, workflowId: 0 },
    { ...input, admissionId: 'not-a-digest' },
    { ...input, headRef: '../bad' },
    { ...input, headRef: '-bad' },
    { ...input, headRef: 'feature.lock' },
    { ...input, headRef: '/leading' },
    { ...input, headRef: 'trailing/' },
    { ...input, headRef: 'a..b' },
    { ...input, headRef: 'a@{b' },
    { ...input, headRef: '@' },
    { ...input, headRef: 'feature//task9' },
    { ...input, headRef: '.hidden' },
    { ...input, headRef: 'feature.' },
    { ...input, headRef: 'feature/task9.lock/next' },
  ]) {
    assert.throws(
      () => checkedTask9Identity(invalid, manifest, policy, metadata),
      /invalid source identity/
    );
  }
  assert.throws(
    () =>
      checkedTask9Identity(
        input,
        manifest,
        {
          repository: { id: 0, name: 'bad' },
        },
        metadata
      ),
    /invalid repository identity/
  );
  assert.throws(
    () =>
      checkedTask9Identity(
        input,
        { ...manifest, baseSha: manifest.reviewedHeadSha },
        policy,
        metadata
      ),
    /invalid source identity/
  );
  assert.throws(
    () =>
      checkedTask9Identity(input, manifest, policy, {
        ...metadata,
        reviewedHeadSha: sha40,
      }),
    /invalid source identity/
  );
});

test('rejects a successful deployment receipt from a different repository', () => {
  assert.throws(
    () =>
      checkedTask9Identity(
        {
          ...input,
          authorityReceipt: {
            ...input.authorityReceipt,
            repository: { id: 456, name: 'fork/Baci' },
          },
        },
        manifest,
        policy,
        metadata
      ),
    /invalid source identity/
  );
});
