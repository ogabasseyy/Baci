import { createHash } from 'node:crypto';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';

export function rehashSnapshot(value: Record<string, unknown>) {
  const { inventorySha256: _digest, ...payload } = value;
  return {
    ...payload,
    inventorySha256: createHash('sha256')
      .update(canonicalizeStorefrontEdgeInventoryValue(payload))
      .digest('hex'),
  };
}
