interface ComparePairKeys {
  leftKey: string;
  rightKey: string;
}

/**
 * A compare route must name two distinct decoded keys. This intentionally does
 * not resolve aliases: only an exact duplicate is definitively impossible
 * before the inventory and product-detail loaders run.
 */
export function isSelfComparePair({
  leftKey,
  rightKey,
}: ComparePairKeys): boolean {
  return leftKey === rightKey;
}
