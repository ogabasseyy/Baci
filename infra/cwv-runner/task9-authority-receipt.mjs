import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { readHeldTask9File } from './task9-held-file.mjs';

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const fail = () => {
  throw new TypeError('invalid Task 9 authority receipt');
};

export function readTask9AuthorityReceipt(path, digestPath, verify) {
  if (typeof verify !== 'function') fail();
  const input = readHeldTask9File(path, 0o600, { maxBytes: 1_048_576 });
  const digest = readHeldTask9File(digestPath, 0o600, { maxBytes: 256 });
  try {
    const hash = createHash('sha256').update(input.bytes).digest('hex');
    if (digest.bytes.toString() !== `${hash}\n`) fail();
    let value;
    try {
      value = JSON.parse(input.bytes);
    } catch {
      fail();
    }
    if (
      !value ||
      Array.isArray(value) ||
      canonicalJson(value) !== input.bytes.toString()
    )
      fail();
    if (
      canonicalJson(Object.keys(value).sort()) !==
      canonicalJson(
        [
          'coherence',
          'deploymentSha',
          'metadataSha256',
          'repository',
          'status',
          'workflow',
        ].sort()
      )
    )
      fail();
    if (
      !SHA.test(value.deploymentSha) ||
      value.status !== 'success' ||
      value.coherence !== 'success' ||
      !DIGEST.test(value.metadataSha256)
    )
      fail();
    if (
      !value.repository ||
      typeof value.repository.name !== 'string' ||
      !Number.isSafeInteger(value.repository.id) ||
      value.repository.id < 1
    )
      fail();
    if (
      value.workflow?.path !== '.github/workflows/deploy.yml' ||
      !Number.isSafeInteger(value.workflow.id) ||
      value.workflow.id < 1 ||
      value.workflow.sha !== value.deploymentSha
    )
      fail();
    const run = verify(
      `/repos/${value.repository.name}/actions/runs/${value.workflow.id}`
    );
    const jobs = verify(
      `/repos/${value.repository.name}/actions/runs/${value.workflow.id}/jobs?per_page=100`
    );
    if (
      run?.id !== value.workflow.id ||
      run?.status !== 'completed' ||
      run?.conclusion !== 'success' ||
      run?.event !== 'push' ||
      run?.head_branch !== 'main' ||
      run?.head_sha !== value.deploymentSha ||
      run?.path !== value.workflow.path ||
      run?.repository?.id !== value.repository.id ||
      run?.repository?.full_name !== value.repository.name ||
      !jobs?.jobs?.some(
        (job) =>
          job.name === 'deploy-production' && job.conclusion === 'success'
      )
    )
      fail();
    return value;
  } finally {
    input.close?.();
    digest.close?.();
  }
}
