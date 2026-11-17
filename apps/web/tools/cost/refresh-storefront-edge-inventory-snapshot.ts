import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';
import { updateStorefrontEdgeSnapshotExpectations } from './update-storefront-edge-snapshot-expectations';

const DEFAULT_INVENTORY_PATH =
  'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json';
const DEFAULT_TEST_PATH =
  'apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts';

type RefreshOptions = Readonly<{
  repoRoot: string;
  sourceSha: string;
  inventoryPath?: string;
  testPath?: string;
  pilotCandidateHostnames?: readonly string[];
  posthogRelayPath?: string;
}>;

function contentDigest(artifact: Record<string, unknown>) {
  const {
    originMainSha: _sourceSha,
    inventorySha256: _digest,
    ...content
  } = artifact;
  return createHash('sha256')
    .update(canonicalizeStorefrontEdgeInventoryValue(content))
    .digest('hex');
}

/**
 * Regenerates the checked-in storefront edge inventory snapshot from the
 * committed tree at `sourceSha`. Only the source SHA metadata changes on every
 * commit, so drift is decided on content alone; when content drifted, the
 * snapshot JSON and the repository test's expected digest/row count are
 * rewritten in place.
 */
export async function refreshStorefrontEdgeInventorySnapshot(
  options: RefreshOptions
) {
  if (!/^[a-f0-9]{40}$/.test(options.sourceSha))
    throw new Error('source SHA must be a full 40-character commit SHA');
  const inventoryPath = join(
    options.repoRoot,
    options.inventoryPath ?? DEFAULT_INVENTORY_PATH
  );
  const testPath = join(
    options.repoRoot,
    options.testPath ?? DEFAULT_TEST_PATH
  );
  const current = await readStorefrontEdgeInventory(inventoryPath);
  const regenerated = await createStorefrontEdgeInventory({
    repoRoot: options.repoRoot,
    originMainSha: options.sourceSha,
    pilotCandidateHostnames: options.pilotCandidateHostnames ?? [
      'baci-edge-pilot.usebaci.com',
    ],
    posthogRelayPath: options.posthogRelayPath ?? '/baci-relay',
  });
  const regeneratedDigest = contentDigest(regenerated);
  if (contentDigest(current) === regeneratedDigest)
    return { changed: false as const, contentDigest: regeneratedDigest };

  // Rewrite the test before the snapshot so a test-shape failure leaves the
  // snapshot untouched and the workflow exits without a half-applied refresh.
  const testSource = await readFile(testPath, 'utf8');
  const updatedTest = updateStorefrontEdgeSnapshotExpectations(testSource, {
    snapshotSha256: regenerated.inventorySha256,
    rowCount: regenerated.rows.length,
  });
  await writeFile(testPath, updatedTest);
  await writeFile(inventoryPath, `${JSON.stringify(regenerated, null, 2)}\n`);
  return {
    changed: true as const,
    contentDigest: regeneratedDigest,
    inventorySha256: regenerated.inventorySha256,
    previousRowCount: Array.isArray(current.rows) ? current.rows.length : null,
    rowCount: regenerated.rows.length,
  };
}

function parseArguments(args: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      (option !== '--repo-root' && option !== '--source-sha') ||
      !value ||
      values.has(option)
    )
      throw new Error('usage: --repo-root <path> --source-sha <sha>');
    values.set(option, value);
  }
  const repoRoot = values.get('--repo-root');
  const sourceSha = values.get('--source-sha');
  if (!repoRoot || !sourceSha)
    throw new Error('usage: --repo-root <path> --source-sha <sha>');
  return { repoRoot, sourceSha };
}

/** CLI entry: prints the refresh result as one JSON line. */
export async function runRefreshStorefrontEdgeInventorySnapshotCli(
  args: readonly string[]
) {
  const result = await refreshStorefrontEdgeInventorySnapshot(
    parseArguments(args)
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runRefreshStorefrontEdgeInventorySnapshotCli(process.argv.slice(2)).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack : String(error)}\n`
      );
      process.exitCode = 1;
    }
  );
}
