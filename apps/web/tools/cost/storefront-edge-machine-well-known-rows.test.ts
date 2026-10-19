import { describe, expect, it } from 'vitest';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeMachineWellKnownRows } from './storefront-edge-machine-well-known-rows';

describe('createStorefrontEdgeMachineWellKnownRows', () => {
  it('returns the reviewed discovery and unlisted well-known families', () => {
    // Arrange
    const machineFamily = (
      id: string,
      routePattern: string,
      methods: StorefrontEdgeInventory['rows'][number]['methods'],
      decision: StorefrontEdgeInventory['rows'][number]['decision'] = 'origin_dynamic'
    ): StorefrontEdgeInventory['rows'][number] => ({
      decision,
      id,
      methods,
      reason: 'test',
      routePattern,
      sourceKind: 'machine_family',
    });

    // Act
    const rows = createStorefrontEdgeMachineWellKnownRows(machineFamily);

    // Assert
    expect(rows).toHaveLength(20);
    expect(rows.at(-1)).toEqual(
      expect.objectContaining({
        id: 'machine:well-known-unlisted',
        methods: ['ANY'],
        decision: 'edge_terminal',
      })
    );
  });
});
