import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('readStorefrontEdgeSourceAuthority', () => {
  it('rejects an option-shaped revision before invoking Git', async () => {
    // Arrange
    let caught: unknown;

    // Act
    try {
      await readStorefrontEdgeSourceAuthority({
        apiRoot,
        originMainSha: '--help',
        repoRoot: '/path/that/does/not/exist',
        routeRoots,
        routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
      });
    } catch (error) {
      caught = error;
    }

    // Assert
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      message: 'source tree does not match the approved commit',
    });
    expect(caught).not.toHaveProperty('cause');
  });

  it('returns approved route and routing-input bytes from the same commit', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    // Act
    const snapshot = await readStorefrontEdgeSourceAuthority({
      apiRoot,
      originMainSha,
      repoRoot,
      routeRoots,
      routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
    });

    // Assert
    expect(snapshot.apiSources.map(({ sourcePath }) => sourcePath)).toEqual([
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/app/api/orders/route.ts',
    ]);
    expect(snapshot.routeSources).toHaveLength(102);
    expect(snapshot.routingInputSources).toHaveLength(
      STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths.length
    );
  });

  it('includes static metadata files in the approved route tree', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-metadata-'));
    temporaryRoots.push(repoRoot);
    await createStorefrontEdgeInventoryFixture(repoRoot);
    const metadataPath =
      'apps/web/src/app/(storefront)/[slug]/opengraph-image.jpg';
    await writeFile(join(repoRoot, metadataPath), 'approved image bytes');
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'add',
      metadataPath,
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'commit',
      '--quiet',
      '-m',
      'add static metadata fixture',
    ]);
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      'HEAD',
    ]);

    // Act
    const snapshot = await readStorefrontEdgeSourceAuthority({
      apiRoot,
      originMainSha: stdout.trim(),
      repoRoot,
      routeRoots,
      routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
    });

    // Assert
    expect(snapshot.routeSources.map(({ sourcePath }) => sourcePath)).toContain(
      metadataPath
    );
  });

  it('ignores internal API route drift outside the reviewed storefront inventory', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-internal-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    const internalRoute = join(
      repoRoot,
      'apps/web/src/app/api/internal/builder-ai-attestation-smoke/route.ts'
    );
    await mkdir(dirname(internalRoute), { recursive: true });
    await writeFile(
      internalRoute,
      'export async function POST() { return new Response(null, { status: 404 }); }\n'
    );

    // Act
    const snapshot = await readStorefrontEdgeSourceAuthority({
      apiRoot,
      originMainSha,
      repoRoot,
      routeRoots,
      routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
    });

    // Assert
    expect(snapshot.apiSources.map(({ sourcePath }) => sourcePath)).toEqual([
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/app/api/orders/route.ts',
    ]);
  });

  it('rejects changed routing-input bytes', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-drift-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    await writeFile(
      join(repoRoot, 'apps/web/src/proxy.ts'),
      '// unapproved change\n'
    );

    // Act and assert
    await expect(
      readStorefrontEdgeSourceAuthority({
        apiRoot,
        originMainSha,
        repoRoot,
        routeRoots,
        routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
      })
    ).rejects.toThrow('source tree does not match the approved commit');
  });

  it('rejects a tree object instead of a commit', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-tree-'));
    temporaryRoots.push(repoRoot);
    const commitSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      `${commitSha}^{tree}`,
    ]);
    const treeSha = stdout.trim();

    // Act and assert
    await expect(
      readStorefrontEdgeSourceAuthority({
        apiRoot,
        originMainSha: treeSha,
        repoRoot,
        routeRoots,
        routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
      })
    ).rejects.toThrow('source tree does not match the approved commit');
  });

  it('rejects a commit that is not reachable from HEAD', async () => {
    // Arrange
    const repoRoot = await mkdtemp(join(tmpdir(), 'edge-authority-orphan-'));
    temporaryRoots.push(repoRoot);
    const orphanedSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    await writeFile(
      join(repoRoot, 'apps/web/src/proxy.ts'),
      '// amended fixture\n'
    );
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'add',
      'apps/web/src/proxy.ts',
    ]);
    await execFileAsync('git', [
      '-C',
      repoRoot,
      ...fixtureGitConfig,
      'commit',
      '--quiet',
      '--amend',
      '-m',
      'fixture amended',
    ]);

    // Act and assert
    await expect(
      readStorefrontEdgeSourceAuthority({
        apiRoot,
        originMainSha: orphanedSha,
        repoRoot,
        routeRoots,
        routingInputPaths: STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths,
      })
    ).rejects.toThrow('source tree does not match the approved commit');
  });
});
