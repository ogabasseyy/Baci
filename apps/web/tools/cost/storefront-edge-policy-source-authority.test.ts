import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('storefront edge policy source authority', () => {
  it('rejects a declared policy source absent from the approved tree', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-policy-source-'));
    temporaryRoots.push(repoRoot);
    await createStorefrontEdgeInventoryFixture(repoRoot);
    await rm(
      join(
        repoRoot,
        'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/actions.ts'
      )
    );
    await execFileAsync('git', ['-C', repoRoot, 'add', '-A']);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      '-c',
      'user.name=Inventory Test',
      '-c',
      'user.email=inventory@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'remove declared policy source',
    ]);
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      'HEAD',
    ]);

    // Act and assert
    await expect(
      createStorefrontEdgeInventory({
        repoRoot,
        originMainSha: stdout.trim(),
        pilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow(
      'policy row source path is not part of the approved source set'
    );
  });
});
