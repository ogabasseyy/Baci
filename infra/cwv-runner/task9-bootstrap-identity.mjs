import { canonicalJson } from './canonical-json.mjs';
import { validGitRef } from './git-ref-validator.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const fail = (message) => {
  throw new TypeError(message);
};
export function checkedTask9Identity(input, manifest, policy, prMetadata) {
  const repository = policy.repository;
  if (
    !repository ||
    canonicalJson(Object.keys(repository).sort()) !==
      canonicalJson(['id', 'name'].sort()) ||
    !Number.isSafeInteger(repository.id) ||
    repository.id < 1 ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.name)
  )
    fail('invalid repository identity');
  if (
    !SHA.test(input.deploymentSha) ||
    !SHA.test(manifest.baseSha) ||
    !SHA.test(manifest.reviewedHeadSha) ||
    !SHA.test(manifest.mergeSha) ||
    input.deploymentSha !== manifest.mergeSha ||
    manifest.baseSha === manifest.reviewedHeadSha ||
    !validGitRef(input.headRef) ||
    !Number.isSafeInteger(input.workflowId) ||
    input.workflowId < 1 ||
    !DIGEST.test(input.admissionId) ||
    !prMetadata ||
    prMetadata.baseSha !== manifest.baseSha ||
    prMetadata.reviewedHeadSha !== manifest.reviewedHeadSha ||
    prMetadata.mergeSha !== manifest.mergeSha ||
    prMetadata.number !== manifest.prNumber ||
    prMetadata.headRef !== input.headRef ||
    prMetadata.workflowId !== input.workflowId ||
    !input.authorityReceipt ||
    input.authorityReceipt.deploymentSha !== manifest.mergeSha ||
    input.authorityReceipt.metadataSha256 !== input.reviewedPrMetadataSha256 ||
    input.authorityReceipt.repository.id !== repository.id ||
    input.authorityReceipt.repository.name !== repository.name
  )
    fail('invalid source identity');
  return {
    base: { ref: 'refs/heads/main', sha: manifest.baseSha },
    exactRun: {
      admissionId: input.admissionId,
      workflow: {
        id: input.workflowId,
        path: '.github/workflows/cwv-runner-attestation.yml',
        ref: 'refs/heads/main',
      },
    },
    mergeSha: manifest.mergeSha,
    pullRequest: { headRef: input.headRef, number: manifest.prNumber },
    ref: `refs/pull/${manifest.prNumber}/merge`,
    repository,
    reviewedSha: manifest.reviewedHeadSha,
  };
}
