import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const execFileAsync = promisify(execFile);
export const snapshotInput =
  'apps/web/src/components/storefront/ogabassey/pages/checkout-page.tsx';
export const snapshotHosts = ['pilot.usebaci.com'];

export async function snapshotGit(repoRoot: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', [
    '-C',
    repoRoot,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Snapshot Test',
    '-c',
    'user.email=snapshot@example.invalid',
    ...args,
  ]);
  return stdout.trim();
}

export async function arrangeSnapshot(roots: string[]) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'inventory-snapshot-'));
  roots.push(repoRoot);
  const baseSha = await createStorefrontEdgeInventoryFixture(repoRoot);
  await snapshotGit(repoRoot, 'checkout', '-b', 'feature');
  await writeFile(
    join(repoRoot, snapshotInput),
    '// extracted checkout source\n'
  );
  await snapshotGit(repoRoot, 'add', '.');
  await snapshotGit(repoRoot, 'commit', '--quiet', '-m', 'source change');
  const sourceSha = await snapshotGit(repoRoot, 'rev-parse', 'HEAD');
  const artifact = await createStorefrontEdgeInventory({
    repoRoot,
    originMainSha: sourceSha,
    pilotCandidateHostnames: snapshotHosts,
  });
  const inputPath = join(repoRoot, 'snapshot.json');
  await writeFile(inputPath, JSON.stringify(artifact));
  await snapshotGit(repoRoot, 'add', '.');
  await snapshotGit(repoRoot, 'commit', '--quiet', '-m', 'snapshot receipt');
  return {
    repoRoot,
    baseSha,
    sourceSha,
    artifact,
    inputPath,
    expectedPilotCandidateHostnames: snapshotHosts,
  };
}

export function rehashSnapshot(value: Record<string, unknown>) {
  const { inventorySha256: _digest, ...payload } = value;
  return {
    ...payload,
    inventorySha256: createHash('sha256')
      .update(canonicalizeStorefrontEdgeInventoryValue(payload))
      .digest('hex'),
  };
}
