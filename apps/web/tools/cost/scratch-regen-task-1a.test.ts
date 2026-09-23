import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';

// SCRATCH regeneration runner for the Task 1A inventory merge conflict.
// Not part of the deliverable: deleted after use.
describe('scratch-regen-task-1a', () => {
  it('regenerates the merged-tree inventory', async () => {
    const artifact = await createStorefrontEdgeInventory({
      repoRoot: '/tmp/pr-3468',
      originMainSha: "a2606066d0613ae9372858d51ab825bc384c3a98",
      pilotCandidateHostnames: ['baci-edge-pilot.usebaci.com'],
      posthogRelayPath: '/baci-relay',
    });
    await writeFile(
      '/tmp/task-1a-regen.json',
      `${JSON.stringify(artifact, null, 2)}\n`
    );
    console.log(
      JSON.stringify({
        inventorySha256: artifact.inventorySha256,
        rowCount: artifact.rows.length,
        entrypoints: (artifact as { storefrontEntrypointCount?: number })
          .storefrontEntrypointCount,
      })
    );
    expect(artifact.rows.length).toBeGreaterThan(0);
  }, 120_000);
});
