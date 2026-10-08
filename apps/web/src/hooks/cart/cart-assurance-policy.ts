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

/**
 * Single entry point for cart adds: new lines fall back to the merchant
 * default, merges preserve the stored choice. Providers call this instead
 * of branching on assurance state inline, so the oversized cart providers
 * gain no new assurance conditionals.
 */
export function resolveAddedLineAssurance(
  incoming: boolean | undefined,
  existing: { hasAssurance?: boolean } | undefined,
  policy: {
    enableSmartCartPro: boolean;
    merchantSlug: string | null | undefined;
  }
): boolean | undefined {
  if (!existing) return incoming ?? resolveAssuranceDefault(policy);
  return mergeAssuranceChoice(incoming, existing.hasAssurance);
}
