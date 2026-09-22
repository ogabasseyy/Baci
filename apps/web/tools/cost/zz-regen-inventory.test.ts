import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';

// TEMPORARY regen runner: regenerates the checked-in Task 1A artifact
// after conflict resolution (tsx CLI cannot run in this sandbox).
// Delete after use; never commit.
describe('zz regen inventory', () => {
  it('regenerates task-1a-inventory.json', async () => {
    const inventory = await createStorefrontEdgeInventory({
      repoRoot: '/Users/mac/Baci-worktrees/invoice-funnel-20260913',
      originMainSha: '8ce5f040f1d05a6fc9116cf3286265a08460a85d',
      pilotCandidateHostnames: ['baci-edge-pilot.usebaci.com'],
      posthogRelayPath: '/baci-relay',
    });
    await writeFile(
      '/Users/mac/Baci-worktrees/invoice-funnel-20260913/docs/superpowers/evidence/storefront-edge/task-1a-inventory.json',
      `${JSON.stringify(inventory, null, 2)}\n`,
      { mode: 0o600 }
    );
    process.stdout.write(
      `${JSON.stringify({ inventorySha256: inventory.inventorySha256, rowCount: inventory.rows.length })}\n`
    );
    expect(inventory.rows.length).toBeGreaterThan(0);
  });
});
