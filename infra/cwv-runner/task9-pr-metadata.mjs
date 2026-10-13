import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { validGitRef } from './git-ref-validator.mjs';
import { readHeldTask9File } from './task9-held-file.mjs';

const SHA = /^[a-f0-9]{40}$/;
const fail = () => {
  throw new TypeError('invalid preserved PR metadata');
};

// The owner-published review literal is separate from the caller-controlled
// metadata/digest files; matching those files alone never authenticates a PR.

export function readTask9PrMetadata(
  path,
  digestPath,
  { maxBytes = 1_048_576, reviewedSha256, verify } = {}
) {
  if (typeof verify !== 'function') fail();
  const input = readHeldTask9File(path, 0o600, { maxBytes });
  const digest = readHeldTask9File(digestPath, 0o600, { maxBytes: 256 });
  try {
    const actualSha256 = createHash('sha256').update(input.bytes).digest('hex');
    if (
      !/^[a-f0-9]{64}$/.test(reviewedSha256 ?? '') ||
      reviewedSha256 !== actualSha256 ||
      digest.bytes.toString() !== `${actualSha256}\n`
    )
      fail();
    let value;
    try {
      value = JSON.parse(input.bytes);
    } catch {
      fail();
    }
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      canonicalJson(value) !== input.bytes.toString() ||
      canonicalJson(Object.keys(value).sort()) !==
        canonicalJson(
          [
            'baseSha',
            'headRef',
            'mergeSha',
            'number',
            'reviewedHeadSha',
            'workflowId',
          ].sort()
        ) ||
      !SHA.test(value.baseSha) ||
      !SHA.test(value.reviewedHeadSha) ||
      !SHA.test(value.mergeSha) ||
      !Number.isSafeInteger(value.number) ||
      value.number < 1 ||
      !Number.isSafeInteger(value.workflowId) ||
      value.workflowId < 1 ||
      typeof value.headRef !== 'string' ||
      !validGitRef(value.headRef)
    )
      fail();
    const pr = verify(`/repos/ogabasseyy/Baci/pulls/${value.number}`);
    const workflow = verify(
      '/repos/ogabasseyy/Baci/actions/workflows/cwv-runner-attestation.yml'
    );
    if (
      pr?.number !== value.number ||
      pr?.state !== 'closed' ||
      pr?.merged !== true ||
      pr?.merged_at == null ||
      pr?.base?.sha !== value.baseSha ||
      pr?.base?.ref !== 'main' ||
      pr?.base?.repo?.full_name !== 'ogabasseyy/Baci' ||
      pr?.head?.sha !== value.reviewedHeadSha ||
      pr?.head?.ref !== value.headRef ||
      pr?.merge_commit_sha !== value.mergeSha ||
      workflow?.id !== value.workflowId ||
      workflow?.path !== '.github/workflows/cwv-runner-attestation.yml'
    )
      fail();
    return value;
  } finally {
    close(input, digest);
  }
}

function close(input, digest) {
  input.close?.();
  digest.close?.();
}
