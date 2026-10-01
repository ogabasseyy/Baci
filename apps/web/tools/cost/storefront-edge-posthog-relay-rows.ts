import { normalizePostHogProxyPath } from '../../src/lib/posthog/config';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

function normalizeRelayPath(value: string) {
  return normalizePostHogProxyPath(value);
}

/** Freezes the configured PostHog proxy root and children into the inventory. */
export function createStorefrontEdgePosthogRelayRows(
  configuredPath: string
): readonly InventoryRow[] {
  const relayPath = normalizeRelayPath(configuredPath);
  return [relayPath, `${relayPath}/{*path?}`].map((routePattern, index) => ({
    decision: 'origin_dynamic',
    id: `machine:posthog-relay-${index === 0 ? 'root' : 'children'}`,
    methods: ['ANY'],
    reason: 'configured_posthog_relay',
    routePattern,
    sourceKind: 'machine_family',
    sourcePath: 'apps/web/src/proxy.ts',
  }));
}
