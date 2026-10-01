import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';
import { readStorefrontEdgeSourceAuthority } from './storefront-edge-source-authority';

const temporaryRoots: string[] = [];
const routeRoots = [
  'apps/web/src/app/(storefront)/[slug]',
  'apps/web/src/app/(storefront)/ogabassey',
] as const;
const apiRoot = 'apps/web/src/app/api';
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
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      })
    )
  );
});

describe('readStorefrontEdgeSourceAuthority synthetic tips', () => {
  it('accepts an approved commit when a synthetic tip retains matching source bytes', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-synthetic-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
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
      'synthetic tip',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      'checkout',
      '--orphan',
      'codex-review-tip',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'commit',
      '--quiet',
      '-m',
      'codex synthetic tip',
    ]);

    const authority = await readStorefrontEdgeSourceAuthority({
      apiRoot,
      originMainSha,
      repoRoot,
      routeRoots,
      routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
    });

    expect(authority.routeSources.length).toBeGreaterThan(0);
    expect(authority.apiSources.length).toBeGreaterThan(0);
  });
});
