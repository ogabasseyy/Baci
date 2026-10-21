import type { ResolvedOfferResolution } from '@baci/shared/lib';

/**
 * Display stock for one MCP offer resolution: the allocatable stock
 * (policy-capped, parent-inherited) — exactly what checkout
 * enforces. Null is unbounded only for serialized_then_unlimited;
 * any other policy with a missing allocation fails closed at zero
 * (the SQL legacy arm always coalesces, so null there means a
 * partial projection).
 */
export function resolveMcpOfferStock(
  resolution: Pick<
    ResolvedOfferResolution,
    'allocatableStock' | 'effectivePolicy'
  >
): number {
  return (
    resolution.allocatableStock ??
    (resolution.effectivePolicy === 'serialized_then_unlimited'
      ? Number.MAX_SAFE_INTEGER
      : 0)
  );
}
