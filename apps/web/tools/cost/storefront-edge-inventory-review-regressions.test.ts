import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function arrangeFixture() {
  const repoRoot = await mkdtemp(
    join(tmpdir(), 'storefront-edge-review-regression-')
  );
  temporaryRoots.push(repoRoot);
  const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
  return { originMainSha, repoRoot };
}

async function createInventory(repoRoot: string, originMainSha: string) {
  return createStorefrontEdgeInventory({
    originMainSha,
    pilotCandidateHostnames: ['pilot.usebaci.com'],
    repoRoot,
  });
}

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

describe('storefront edge inventory review regressions', () => {
  it('inventories metadata entrypoints and the blog Server Action POST', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await arrangeFixture();

    // Act
    const inventory = await createInventory(repoRoot, originMainSha);

    // Assert
    expect(inventory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'edge_release',
          methods: ['GET', 'HEAD'],
          routePattern: '/blog/sitemap.xml',
          sourcePath: expect.stringMatching(/\/blog\/sitemap\.ts$/),
        }),
        expect.objectContaining({
          decision: 'edge_release',
          methods: ['GET', 'HEAD'],
          routePattern: '/opengraph-image',
          sourcePath: expect.stringMatching(/\/opengraph-image\.tsx$/),
        }),
        expect.objectContaining({
          decision: 'origin_dynamic',
          methods: ['POST'],
          routePattern: '/blog/{postSlug}',
          sourceKind: 'automatic_subresource',
        }),
      ])
    );
  });

  it('rejects a working tree that does not match the recorded source SHA', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await arrangeFixture();
    await writeFile(
      join(repoRoot, 'apps/web/src/app/(storefront)/[slug]/(home)/page.tsx'),
      'export default function ChangedPage() { return null; }\n'
    );

    // Act and assert
    await expect(createInventory(repoRoot, originMainSha)).rejects.toThrow(
      'source tree does not match the approved commit'
    );
  });

  it('includes layout and browser-shell changes in the routing digests', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await arrangeFixture();
    const before = await createInventory(repoRoot, originMainSha);
    await writeFile(
      join(repoRoot, 'apps/web/src/app/root-dynamic-body.tsx'),
      'export function RootDynamicBody() { return null; }\n'
    );
    await execFileAsync('git', ['-C', repoRoot, 'add', '.']);
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
      'change browser shell',
    ]);
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      'HEAD',
    ]);

    // Act
    const after = await createInventory(repoRoot, stdout.trim());

    // Assert
    expect(after.routingProxyInputSha256).not.toBe(
      before.routingProxyInputSha256
    );
  });

  it('enumerates real API handlers without an allowed-family wildcard escape', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await arrangeFixture();

    // Act
    const inventory = await createInventory(repoRoot, originMainSha);

    // Assert
    expect(inventory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          methods: ['OPTIONS', 'POST'],
          routePattern: '/api/events',
        }),
        expect.objectContaining({
          methods: ['OPTIONS', 'POST'],
          routePattern: '/api/orders',
        }),
      ])
    );
    expect(
      inventory.rows.some((row) => row.routePattern === '/api/orders/{id}')
    ).toBe(false);
    expect(
      inventory.rows.some((row) => row.routePattern === '/api/orders/{*path}')
    ).toBe(false);
  });
});
