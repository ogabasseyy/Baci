import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import task1aInventory from '../../../../docs/superpowers/evidence/storefront-edge/task-1a-inventory.json';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const temporaryRoots: string[] = [];

async function fixtureRoot() {
  const root = await mkdtemp(joinTemporaryRoot('storefront-edge-inventory-'));
  temporaryRoots.push(root);
  const originMainSha = await createStorefrontEdgeInventoryFixture(root);
  return { originMainSha, repoRoot: root };
}

function joinTemporaryRoot(name: string) {
  return resolve(tmpdir(), name);
}
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      })
    )
  );
});

describe('createStorefrontEdgeInventory', () => {
  it('creates the same canonical inventory regardless of hostname input order', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await fixtureRoot();

    // Act
    const first = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha: originMainSha.toUpperCase(),
      pilotCandidateHostnames: [' Shop.Example.com. ', 'pilot.usebaci.com'],
    });
    const second = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha,
      pilotCandidateHostnames: ['pilot.usebaci.com', 'shop.example.com'],
    });

    // Assert
    expect(first).toEqual(second);
    expect(first.originMainSha).toBe(originMainSha);
    expect(first.authority).toBe('directional_cost_screen_only');
    expect(first.pilotCandidateHostnames).toEqual([
      'pilot.usebaci.com',
      'shop.example.com',
    ]);
    expect(first.inventorySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.routeTreeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.routingProxyInputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.pilotCandidateHostnameSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/createdAt|updatedAt|timestamp/i);
  });

  it('classifies static, redirect, and dynamic storefront entrypoints in canonical order', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await fixtureRoot();

    // Act
    const inventory = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha,
      pilotCandidateHostnames: ['pilot.usebaci.com'],
    });
    const entrypoints = inventory.rows.filter(
      (row) => row.sourceKind === 'storefront_entrypoint'
    );

    // Assert
    expect(entrypoints.length).toBeGreaterThanOrEqual(84);
    const indexOf = (pattern: string) =>
      entrypoints.findIndex((row) => row.routePattern === pattern);
    expect(indexOf('/blog/news-sitemap.xml')).toBeLessThan(
      indexOf('/blog/{postSlug}')
    );
    expect(indexOf('/blog/{postSlug}')).toBeLessThan(
      indexOf('/blog/{*catchAll}')
    );
    expect(entrypoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routePattern: '/',
          decision: 'edge_release',
        }),
        expect.objectContaining({
          routePattern: '/blog/{*catchAll}',
          decision: 'origin_dynamic',
          methods: ['GET', 'HEAD'],
        }),
        expect.objectContaining({
          routePattern: '/products',
          decision: 'edge_release',
        }),
        expect.objectContaining({
          routePattern: '/search',
          decision: 'origin_dynamic',
        }),
        expect.objectContaining({
          routePattern: '/checkout',
          decision: 'origin_dynamic',
        }),
      ])
    );
    expect(inventory.eligibleDenominatorPolicy).toEqual(
      expect.objectContaining({
        decisions: ['edge_redirect', 'edge_release'],
        methods: ['GET', 'HEAD'],
        zeroDenominatorVerdict: 'NOT_PROVEN',
      })
    );
    expect(inventory.completeBrowserPathClasses).toContain(
      'automatic_origin_forbidden'
    );
  });

  it('classifies every current storefront entrypoint without changing proxy.ts', async () => {
    // Arrange
    const repoRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../..'
    );
    const { stdout: currentSha } = await execFileAsync(
      'git',
      ['-C', repoRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    );
    if (currentSha.trim() !== task1aInventory.originMainSha) return;

    // Act
    const inventory = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha: task1aInventory.originMainSha,
      pilotCandidateHostnames: task1aInventory.pilotCandidateHostnames,
    });
    const entrypoints = inventory.rows.filter(
      (row) => row.sourceKind === 'storefront_entrypoint'
    );
    const expectedSourcePaths = [
      ...new Set(
        task1aInventory.rows
          .filter((row) => row.sourceKind === 'storefront_entrypoint')
          .map((row) => row.sourcePath)
      ),
    ];

    // Assert
    expect(entrypoints.length).toBeGreaterThan(0);
    expect(
      [...new Set(entrypoints.map((row) => row.sourcePath))].sort()
    ).toEqual(expectedSourcePaths.sort());
    expect(
      entrypoints.find(
        (row) => row.routePattern === '/{category}/{productSlug}'
      )?.decision
    ).toBe('edge_release');
    expect(
      entrypoints.find((row) => row.routePattern === '/product/{productSlug}')
        ?.decision
    ).toBe('origin_dynamic');
    expect(
      entrypoints.find((row) => row.routePattern === '/quiz')?.decision
    ).toBe('origin_dynamic');
    expect(
      entrypoints.find((row) => row.routePattern === '/pages/rewards')?.decision
    ).toBe('origin_dynamic');
  });

  it('inventories explicit proxy aliases and required runtime families before closed defaults', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await fixtureRoot();

    // Act
    const inventory = await createStorefrontEdgeInventory({
      repoRoot,
      originMainSha,
      pilotCandidateHostnames: ['pilot.usebaci.com'],
    });
    const rowIds = new Set(inventory.rows.map((row) => row.id));

    // Assert
    expect(new Set(inventory.rows.map((row) => row.id)).size).toBe(
      inventory.rows.length
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'machine:posthog-relay-root')
    ).toBeLessThan(
      inventory.rows.findIndex(({ id }) => id === 'proxy:unsupported-method')
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'machine:posthog-relay-root')
    ).toBeLessThan(
      inventory.rows.findIndex(({ id }) => id === 'proxy:no-trailing-slash')
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'machine:posthog-relay-root')
    ).toBeLessThan(
      inventory.rows.findIndex(
        ({ id }) => id === 'proxy:platform-route-subdomain'
      )
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'next:home-legacy')
    ).toBeLessThan(
      inventory.rows.findIndex(({ id }) => id === 'proxy:no-trailing-slash')
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'next:user-legacy')
    ).toBeLessThan(
      inventory.rows.findIndex(({ id }) => id === 'proxy:no-trailing-slash')
    );
    const apiRowIndexes = inventory.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.sourceKind === 'api_route')
      .map(({ index }) => index);
    expect(inventory.rows.findIndex(({ id }) => id === 'api:unlisted')).toBe(
      Math.max(...apiRowIndexes) + 1
    );
    expect(
      inventory.rows.findIndex(({ id }) => id === 'api:unlisted')
    ).toBeLessThan(
      inventory.rows.findIndex(
        ({ sourceKind }) => sourceKind === 'storefront_entrypoint'
      )
    );
    for (const requiredId of [
      'api-route:events/route.ts',
      'api-route:orders/route.ts',
      'api:unlisted',
      'next:user-legacy',
      'next:product-category',
      'machine:indexnow-key-root',
      'machine:indexnow-key-custom-domain',
      'machine:openapi',
      'machine:well-known-acp',
      'proxy:blog-query-canonical',
      'proxy:blog-wordpress-probe',
      'proxy:blog-spam-prefix',
      'proxy:api-prefix-passthrough',
      'proxy:cache-safe-punctuation',
      'proxy:legacy-analytics-conversion',
      'proxy:legacy-klump-webhook',
      'proxy:legacy-terms-alias-custom-domain',
      'proxy:lowercase-document',
      'proxy:retired-slug-api',
      'proxy:retired-slug-document',
      'proxy:root-sitemap',
      'proxy:root-domain-current-slug',
      'proxy:unsupported-method',
      'request-override:draft-mode-nested',
    ]) {
      expect(rowIds, `missing ${requiredId}`).toContain(requiredId);
    }
  });

  it('rejects invalid source authority and candidate hostnames', async () => {
    // Arrange
    const { originMainSha, repoRoot } = await fixtureRoot();

    // Act and assert
    await expect(
      createStorefrontEdgeInventory({
        repoRoot,
        originMainSha: 'main',
        pilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow('origin main SHA');
    await expect(
      createStorefrontEdgeInventory({
        repoRoot,
        originMainSha,
        pilotCandidateHostnames: ['https://pilot.usebaci.com/path'],
      })
    ).rejects.toThrow('pilot candidate hostname');
  });
});
const execFileAsync = promisify(execFile);
