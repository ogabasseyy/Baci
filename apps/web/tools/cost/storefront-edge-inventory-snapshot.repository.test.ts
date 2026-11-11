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
      'd943ff4087a7d0b627a09d9cc2ad850e83eacb340f2808d72d90c9e227f7f448',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 630,
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
  expect(cartRows).toHaveLength(12);
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
  expect(rows).toHaveLength(24);
  expect(rows).toContainEqual(
    expect.objectContaining({
      sourcePath:
        'apps/web/src/app/api/payments/oxygen/storefront-availability/route.ts',
      decision: 'origin_dynamic',
    })
  );
  for (const row of rows) expect(row.decision).toBe('origin_dynamic');
});

it('keeps wallet PIN routes on the dynamic origin', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const inventory = await readStorefrontEdgeInventory(
    join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    )
  );
  const rows = inventory.rows.filter((row) =>
    row.sourcePath?.startsWith(
      'apps/web/src/app/api/storefront/customer/wallet-pin/'
    )
  );
  expect(rows).toHaveLength(4);
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

it('keeps the savings goal completion endpoint on the dynamic origin', async () => {
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
        'apps/web/src/app/api/storefront/customer/savings/goal-complete/route.ts',
      decision: 'origin_dynamic',
    })
  );
});

it('keeps Chatwoot context endpoints on the dynamic origin', async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const inventory = await readStorefrontEdgeInventory(
    join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    )
  );
  const rows = inventory.rows.filter((row) =>
    row.sourcePath?.startsWith(
      'apps/web/src/app/api/storefront/chatwoot/context/'
    )
  );
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.routePattern).sort()).toEqual([
    '/api/storefront/chatwoot/context/authorize',
    '/api/storefront/chatwoot/context/challenge',
    '/api/storefront/chatwoot/context/verify',
  ]);
  expect(rows.every((row) => row.decision === 'origin_dynamic')).toBe(true);
});
