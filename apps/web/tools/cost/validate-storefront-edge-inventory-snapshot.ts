import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';

const execFileAsync = promisify(execFile);

/**
 * Checks a repository regression snapshot against HEAD's committed source.
 * Historical commit identity is metadata here: squash/rebase can remove it.
 * This does not certify that historical provenance or produce release evidence.
 * Operational evidence must still use validateStorefrontEdgeInventory with its
 * independently supplied exact source SHA.
 */
export async function validateStorefrontEdgeInventorySnapshot(options: {
  repoRoot: string;
  inputPath: string;
  expectedPilotCandidateHostnames: readonly string[];
  expectedPosthogRelayPath?: string;
}) {
  const artifact = await readStorefrontEdgeInventory(options.inputPath);
  const { originMainSha, inventorySha256, ...content } = artifact;
  if (
    !/^[a-f0-9]{40}$/.test(originMainSha) ||
    typeof inventorySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(inventorySha256)
  )
    throw new Error('inventory snapshot has invalid identity metadata');
  const digest = createHash('sha256')
    .update(
      canonicalizeStorefrontEdgeInventoryValue({ ...content, originMainSha })
    )
    .digest('hex');
  if (digest !== inventorySha256)
    throw new Error('inventory snapshot digest does not match its content');

  const { stdout } = await execFileAsync('git', [
    '-C',
    options.repoRoot,
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]);
  const validatedSourceSha = stdout.trim();
  // The existing source-authority reader still binds every included path and
  // byte to this commit, rejecting dirty files, additions, deletions and links.
  const regenerated = await createStorefrontEdgeInventory({
    repoRoot: options.repoRoot,
    originMainSha: validatedSourceSha,
    pilotCandidateHostnames: options.expectedPilotCandidateHostnames,
    posthogRelayPath: options.expectedPosthogRelayPath ?? '/baci-relay',
  });
  const {
    originMainSha: _currentSourceSha,
    inventorySha256: _currentDigest,
    ...currentContent
  } = regenerated;
  if (
    canonicalizeStorefrontEdgeInventoryValue(content) !==
    canonicalizeStorefrontEdgeInventoryValue(currentContent)
  )
    throw new Error('inventory snapshot does not match committed source');

  return {
    validationKind: 'repository_snapshot' as const,
    snapshotSha256: inventorySha256,
    validatedSourceSha,
    rowCount: regenerated.rows.length,
  };
}
