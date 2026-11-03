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
      '3044eb92b197d58b3c3787f5cf962bca2df5e430a063a176480435ee6b243f53',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 607,
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
  expect(cartRows).toHaveLength(11);
  expect(cartRows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourcePath:
          'apps/web/src/app/api/storefront/cart/checkout/reconcile/route.ts',
        decision: 'origin_dynamic',
      }),
    ])
  );
  for (const row of cartRows) expect(row.decision).toBe('origin_dynamic');
});

it('keeps every Oxygen API route on the dynamic origin', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const inventory = await readStorefrontEdgeInventory(
    join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    )
  );
  const rows = inventory.rows.filter((row) =>
    row.sourcePath?.startsWith('apps/web/src/app/api/payments/oxygen/')
  );
  expect(rows).toHaveLength(21);
  for (const row of rows) expect(row.decision).toBe('origin_dynamic');
});

it('keeps the savings PIN verification endpoint on the dynamic origin', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const inventory = await readStorefrontEdgeInventory(
    join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    )
  );
  expect(inventory.rows).toContainEqual(
    expect.objectContaining({
      sourcePath:
        'apps/web/src/app/api/storefront/customer/savings/goal-pin/verify/route.ts',
      decision: 'origin_dynamic',
    })
  );
});
