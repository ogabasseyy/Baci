import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';
import { validateStorefrontEdgeInventory } from './validate-storefront-edge-inventory';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const fixtureGitConfig = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=0',
  '-c',
  'user.name=Inventory Test',
  '-c',
  'user.email=inventory@example.invalid',
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('bugfix: squash tip drops originMainSha ancestry', () => {
  it('still validates when HEAD is an orphan tip that retains matching source bytes', async () => {
    // Arrange — mirrors GitHub/Codex squash previews: approved commit exists,
    // source bytes match, but merge-base --is-ancestor fails.
    const repoRoot = await mkdtemp(
      join(tmpdir(), 'storefront-edge-squash-ancestry-')
    );
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    const artifact = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha,
      pilotCandidateHostnames: ['pilot.usebaci.com'],
    });
    const inputPath = join(repoRoot, 'task-1a-inventory.json');
    await writeFile(inputPath, `${JSON.stringify(artifact, null, 2)}\n`);
    await mkdir(join(repoRoot, 'docs/superpowers/evidence/storefront-edge'), {
      recursive: true,
    });
    await writeFile(
      join(repoRoot, 'docs/superpowers/evidence/storefront-edge/note.txt'),
      'inventory-only tip change\n'
    );
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'add',
      'docs/superpowers/evidence/storefront-edge/note.txt',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'commit',
      '--quiet',
      '-m',
      'inventory-only tip',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      'checkout',
      '--orphan',
      'codex-squash-tip',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'commit',
      '--quiet',
      '-m',
      'codex squash tip',
    ]);
    await expect(
      execFileAsync('git', [
        '-C',
        repoRoot,
        'merge-base',
        '--is-ancestor',
        originMainSha,
        'HEAD',
      ])
    ).rejects.toThrow();

    // Act
    const result = await validateStorefrontEdgeInventory({
      repoRoot,
      inputPath,
      expectedOriginMainSha: originMainSha,
      expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
    });

    // Assert
    expect(result).toEqual({
      inventorySha256: artifact.inventorySha256,
      rowCount: artifact.rows.length,
      storefrontEntrypointCount: 76,
    });
  });
});
