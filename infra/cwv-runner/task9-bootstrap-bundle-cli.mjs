import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './canonical-json.mjs';
import { generateTask9BootstrapBundle } from './task9-bootstrap-bundle.mjs';

const FIELDS = Object.freeze(
  Object.assign(Object.create(null), {
    '--admission-id': 'admissionId',
    '--authority-receipt': 'authorityReceiptPath',
    '--authority-receipt-sha256': 'authorityReceiptDigestPath',
    '--bundle-id': 'bundleId',
    '--cwd': 'cwd',
    '--deployment-sha': 'deploymentSha',
    '--generation': 'generation',
    '--head-ref': 'headRef',
    '--node': 'nodePath',
    '--node-archive': 'nodeArchivePath',
    '--node-provenance': 'nodeProvenancePath',
    '--output-root': 'outputRoot',
    '--pr-metadata': 'prMetadataPath',
    '--pr-metadata-sha256': 'prMetadataDigestPath',
    '--reviewed-pr-metadata-sha256': 'reviewedPrMetadataSha256',
    '--source-archive': 'sourceArchivePath',
    '--source-archive-sha256': 'sourceArchiveDigestPath',
    '--source-manifest': 'sourceManifestPath',
    '--source-manifest-sha256': 'sourceManifestDigestPath',
    '--transaction-id': 'transactionId',
    '--workflow-id': 'workflowId',
  })
);
const fail = () => {
  throw new TypeError('invalid Task 9 bundle invocation');
};

export function runTask9BootstrapBundleCli(argv, dependencies = {}) {
  if (!Array.isArray(argv) || argv.length !== Object.keys(FIELDS).length * 2)
    fail();
  const input = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!Object.hasOwn(FIELDS, argv[index])) fail();
    const field = FIELDS[argv[index]];
    const value = argv[index + 1];
    if (
      !field ||
      Object.hasOwn(input, field) ||
      typeof value !== 'string' ||
      !value
    )
      fail();
    input[field] = value;
  }
  if (Object.keys(input).length !== Object.keys(FIELDS).length) fail();
  for (const field of ['generation', 'workflowId']) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(input[field])) fail();
    input[field] = Number(input[field]);
    if (!Number.isSafeInteger(input[field])) fail();
  }
  const generate = dependencies.generate ?? generateTask9BootstrapBundle;
  input.verifyGithub = dependencies.verifyGithub;
  return canonicalJson(generate(input));
}

try {
  if (
    import.meta.url.startsWith('file:') &&
    process.argv[1] &&
    realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
  ) {
    throw new TypeError('launcher required');
  }
} catch {
  process.stderr.write('task9-bootstrap-bundle refused\n');
  process.exitCode = 1;
}
