import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** Creates a canonical proxy-path inventory row without emitting undefined keys. */
export function createStorefrontEdgeProxyClass(
  id: string,
  routePattern: string,
  methods: InventoryRow['methods'],
  decision: InventoryRow['decision'],
  reason: string,
  options: Readonly<{
    hostCondition?: InventoryRow['hostCondition'];
    pathCondition?: InventoryRow['pathCondition'];
    sourcePath?: string;
  }> = {}
): InventoryRow {
  return {
    decision,
    id,
    methods,
    reason,
    routePattern,
    sourceKind: 'proxy_path_class',
    ...(options.hostCondition ? { hostCondition: options.hostCondition } : {}),
    ...(options.pathCondition ? { pathCondition: options.pathCondition } : {}),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
  };
}
