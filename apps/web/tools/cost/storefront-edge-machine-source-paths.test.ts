import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';
import { STOREFRONT_EDGE_MACHINE_ROWS } from './storefront-edge-machine-rows';
import { STOREFRONT_EDGE_MACHINE_SOURCE_PATHS } from './storefront-edge-machine-source-paths';

describe('STOREFRONT_EDGE_MACHINE_SOURCE_PATHS', () => {
  it('binds every machine row to one repository-relative source', () => {
    // Arrange
    const declaredPatterns = Object.keys(
      STOREFRONT_EDGE_MACHINE_SOURCE_PATHS
    ).sort();
    const rowPatterns = [
      ...new Set(
        STOREFRONT_EDGE_MACHINE_ROWS.filter(
          ({ sourceKind }) => sourceKind === 'machine_family'
        ).map(({ routePattern }) => routePattern)
      ),
    ].sort();

    // Act and assert
    expect(declaredPatterns).toEqual(rowPatterns);
    expect(declaredPatterns.every((pattern) => pattern.startsWith('/'))).toBe(
      true
    );
    expect(
      Object.values(STOREFRONT_EDGE_MACHINE_SOURCE_PATHS).every(
        (sourcePath) =>
          !sourcePath.startsWith('/') &&
          !sourcePath.split('/').includes('..') &&
          sourcePath.startsWith('apps/web/')
      )
    ).toBe(true);
  });

  it('includes transitive implementations behind re-exported agent handlers', () => {
    // Arrange
    const routingInputs = STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths;

    // Act and assert
    expect(routingInputs).toEqual(
      expect.arrayContaining([
        'apps/web/src/app/agent/auth/route.ts',
        'apps/web/src/app/agent/auth/[action]/route.ts',
      ])
    );
  });
});
