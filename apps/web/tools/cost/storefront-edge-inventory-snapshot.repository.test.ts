import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
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
      '5a41d836bd4341fcbbbebce5492f2f15f6eedf058d5cda338827357c20b2f2ae',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 558,
  });
});
