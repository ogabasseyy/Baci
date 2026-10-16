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
      '2cd33c178c62d740c800775c8da0c7069c0547616cd61926d9912fdbb9d07abd',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 583,
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
