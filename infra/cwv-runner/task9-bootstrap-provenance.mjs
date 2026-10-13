import { createHash } from 'node:crypto';

import { canonicalJson } from './task9-bootstrap.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const fail = () => {
  throw new TypeError('invalid Node provenance');
};

export function checkedTask9Provenance(
  bytes,
  nodeBytes,
  nodeArchiveBytes,
  policy,
  verifyNodeArchive
) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail();
  }
  if (
    canonicalJson(value) !== bytes.toString() ||
    !exact(value, [
      'archiveSha256',
      'artifact',
      'checksumSha256',
      'executableSha256',
      'keyringSha256',
      'schemaVersion',
      'sha256',
      'signatureSha256',
      'version',
    ]) ||
    value.artifact !== 'node' ||
    value.schemaVersion !== 1 ||
    value.sha256 !== hash(nodeBytes) ||
    value.executableSha256 !== hash(nodeBytes) ||
    value.archiveSha256 !== policy?.supplyChain?.node?.ownerDarwinArm64Sha256 ||
    value.version !== policy?.supplyChain?.node?.version ||
    value.checksumSha256 !==
      policy?.supplyChainProvenance?.node?.checksumsSha256 ||
    value.keyringSha256 !==
      policy?.supplyChainProvenance?.node?.keyringSha256 ||
    value.signatureSha256 !==
      policy?.supplyChainProvenance?.node?.signatureSha256
  )
    fail();
  verifyNodeArchive({
    archiveBytes: nodeArchiveBytes,
    nodeBytes,
    archiveSha256: value.archiveSha256,
    version: value.version,
  });
  return value;
}
