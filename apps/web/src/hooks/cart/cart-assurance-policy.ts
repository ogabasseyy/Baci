/**
 * Shared Smart Cart Pro assurance policy for the web cart providers.
 * Default-on assurance is Ogabassey-scoped: anywhere else stays opt-in.
 * Merge keeps an explicit incoming choice and otherwise preserves the
 * stored choice, so silent adds never flip an opt-out.
 * An undefined merge result (neither side chose, e.g. legacy persisted
 * lines) is opt-out by contract: fee math, the toggle display/flip, and
 * persistence all treat it as falsy, so it can never charge silently.
 */
export function resolveAssuranceDefault({
  enableSmartCartPro,
  merchantSlug,
}: {
  enableSmartCartPro: boolean;
  merchantSlug: string | null | undefined;
}): boolean {
  return enableSmartCartPro && merchantSlug === 'ogabassey';
}

export function mergeAssuranceChoice(
  incoming: boolean | undefined,
  stored: boolean | undefined
): boolean | undefined {
  return incoming ?? stored;
}
