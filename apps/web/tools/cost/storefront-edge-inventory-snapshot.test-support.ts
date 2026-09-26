import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';
import { snapshotGit } from './storefront-edge-snapshot-git.test-support';

export const snapshotInput =
  'apps/web/src/components/storefront/ogabassey/pages/checkout-page.tsx';
export const snapshotHosts = ['pilot.usebaci.com'];

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
