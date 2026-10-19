import { createHash } from 'node:crypto';
import { authority } from './constants.mjs';
import { verifyArtifact } from './artifact.mjs';
import { prepareConfiguration } from './configuration.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function prepareUpgrade(input) {
  if (!input || Object.keys(input).sort().join('|') !== 'artifact|predecessorBytes')
    throw new Error('Upgrade input scope refused');
  const { predecessorBytes, artifact } = input;
  if (!predecessorBytes || Object.keys(predecessorBytes).sort().join('|') !== 'bundle|config|daemon|private')
    throw new Error('Actual predecessor bytes missing');
  for (const [name, expected] of Object.entries(authority.predecessors)) {
    const bytes = predecessorBytes[name];
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16_000_000 || digest(bytes) !== expected)
      throw new Error('Actual predecessor pin refused');
  }
  const verified = verifyArtifact(artifact);
  const configuration = prepareConfiguration({ baseBytes: predecessorBytes.config,
    privateBytes: predecessorBytes.private, newBundleSha256: verified.bundleSha256 });
  return {
    files: { ...configuration, 'prefunded-replay-bundle.mjs': Buffer.from(artifact.bundleBytes) },
    pins: { predecessor: authority.predecessors, next: { ...authority.predecessors,
      bundle: verified.bundleSha256, config: digest(configuration['config.json']) },
      reviewedManifestSha256: verified.manifestSha256, inventorySha256: authority.frozenInventorySha256,
      parentBaseline: authority.parentBaseline },
    installed: false, providerCalled: false, sqlExecuted: false,
  };
}
