import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';
import { validateStorefrontEdgeInventorySnapshot } from './validate-storefront-edge-inventory-snapshot';

it('binds the checked-in inventory snapshot to current committed source content', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const result = await validateStorefrontEdgeInventorySnapshot({
    repoRoot,
    inputPath: join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    ),
    expectedPilotCandidateHostnames: ['baci-edge-pilot.usebaci.com'],
  });

  expect(result).toEqual({
    validationKind: 'repository_snapshot',
    snapshotSha256:
      '3951b54316603bc20d1698f215f0ab802fa652b2b7c4f1ecda2e56f13252a0c2',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 584,
  });
});

it('keeps every private cart endpoint on the dynamic origin', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const inventory = await readStorefrontEdgeInventory(
    join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    )
  );
  const cartRows = inventory.rows.filter((row) =>
    row.sourcePath?.startsWith('apps/web/src/app/api/storefront/cart/')
  );
  expect(cartRows).toHaveLength(10);
  for (const row of cartRows) expect(row.decision).toBe('origin_dynamic');
});
