import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';
import { refreshStorefrontEdgeInventorySnapshot } from './refresh-storefront-edge-inventory-snapshot';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';
import {
  snapshotHosts,
  snapshotInput,
} from './storefront-edge-inventory-snapshot.test-support';
import { snapshotGit } from './storefront-edge-snapshot-git.test-support';
import { validateStorefrontEdgeInventorySnapshot } from './validate-storefront-edge-inventory-snapshot';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  );
});

const testTemplate = (sha: string, rowCount: number) =>
  `expect(result).toEqual({\n  snapshotSha256:\n    '${sha}',\n  rowCount: ${rowCount},\n});\n`;

async function commitAll(repoRoot: string, message: string) {
  await snapshotGit(repoRoot, 'add', '.');
  await snapshotGit(repoRoot, 'commit', '--quiet', '-m', message);
  return snapshotGit(repoRoot, 'rev-parse', 'HEAD');
}

async function arrangeCheckedInSnapshot(testBody?: string) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'inventory-refresh-'));
  roots.push(repoRoot);
  const baseSha = await createStorefrontEdgeInventoryFixture(repoRoot);
  const artifact = await createStorefrontEdgeInventory({
    repoRoot,
    originMainSha: baseSha,
    pilotCandidateHostnames: snapshotHosts,
  });
  const paths = {
    inventoryPath: 'snapshot.json',
    testPath: 'snapshot.repository.test.ts',
  };
  await writeFile(
    join(repoRoot, paths.inventoryPath),
    `${JSON.stringify(artifact, null, 2)}\n`
  );
  await writeFile(
    join(repoRoot, paths.testPath),
    testBody ?? testTemplate(artifact.inventorySha256, artifact.rows.length)
  );
  await commitAll(repoRoot, 'checked-in snapshot');
  return {
    repoRoot,
    artifact,
    options: { ...paths, pilotCandidateHostnames: snapshotHosts, repoRoot },
  };
}

const readText = (repoRoot: string, path: string) =>
  readFile(join(repoRoot, path), 'utf8');

describe('refreshStorefrontEdgeInventorySnapshot', () => {
  it('leaves files untouched when only the source commit moved', async () => {
    const { repoRoot, options } = await arrangeCheckedInSnapshot();
    await writeFile(join(repoRoot, 'README.md'), 'unrelated change\n');
    const sourceSha = await commitAll(repoRoot, 'unrelated change');
    const before = await readText(repoRoot, options.inventoryPath);

    const result = await refreshStorefrontEdgeInventorySnapshot({
      ...options,
      sourceSha,
    });

    expect(result).toEqual({
      changed: false,
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readText(repoRoot, options.inventoryPath)).toBe(before);
  });

  it('regenerates the snapshot and test expectations when a routing input drifted', async () => {
    const { repoRoot, artifact, options } = await arrangeCheckedInSnapshot();
    await writeFile(
      join(repoRoot, snapshotInput),
      '// changed routing input\n'
    );
    const sourceSha = await commitAll(repoRoot, 'route change');

    const result = await refreshStorefrontEdgeInventorySnapshot({
      ...options,
      sourceSha,
    });

    const refreshed = await readStorefrontEdgeInventory(
      join(repoRoot, options.inventoryPath)
    );
    expect(result).toEqual({
      changed: true,
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      inventorySha256: refreshed.inventorySha256,
      previousRowCount: artifact.rows.length,
      rowCount: (refreshed.rows as unknown[]).length,
    });
    expect(refreshed.originMainSha).toBe(sourceSha);
    expect(refreshed.inventorySha256).not.toBe(artifact.inventorySha256);
    expect(await readText(repoRoot, options.testPath)).toBe(
      testTemplate(
        refreshed.inventorySha256 as string,
        (refreshed.rows as unknown[]).length
      )
    );
    const validatedSha = await commitAll(repoRoot, 'refresh snapshot');
    await expect(
      validateStorefrontEdgeInventorySnapshot({
        repoRoot,
        inputPath: join(repoRoot, options.inventoryPath),
        expectedPilotCandidateHostnames: snapshotHosts,
      })
    ).resolves.toMatchObject({
      snapshotSha256: refreshed.inventorySha256,
      validatedSourceSha: validatedSha,
    });
  });

  it('writes nothing when the test file shape is not recognised', async () => {
    const { repoRoot, options } = await arrangeCheckedInSnapshot(
      'no expectations here\n'
    );
    await writeFile(
      join(repoRoot, snapshotInput),
      '// changed routing input\n'
    );
    const sourceSha = await commitAll(repoRoot, 'route change');
    const before = await readText(repoRoot, options.inventoryPath);

    await expect(
      refreshStorefrontEdgeInventorySnapshot({ ...options, sourceSha })
    ).rejects.toThrow('exactly one snapshotSha256 expectation');
    expect(await readText(repoRoot, options.inventoryPath)).toBe(before);
  });

  it('rejects an abbreviated source SHA', async () => {
    await expect(
      refreshStorefrontEdgeInventorySnapshot({
        repoRoot: tmpdir(),
        sourceSha: 'abc1234',
      })
    ).rejects.toThrow('full 40-character commit SHA');
  });
});
