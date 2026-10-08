/**
 * Cross-app Smart Cart Pro assurance policy: the single entry point for
 * cart adds on web and native, so both apps default, merge, and exclude
 * voucher lines identically.
 *
 * Default-on assurance is Ogabassey-scoped: anywhere else stays opt-in.
 * Quiz/voucher (free-prize) lines never default on: the checkout zeroes
 * their price and fee while the order would still record has_assurance,
 * presenting a free prize as requiring a paid policy. An explicit
 * incoming choice always wins, including on voucher lines.
 * Merge keeps an explicit incoming choice and otherwise preserves the
 * stored choice, so silent adds never flip an opt-out.
 * An undefined merge result (neither side chose, e.g. legacy persisted
 * lines) is opt-out by contract: fee math, the toggle display/flip, and
 * persistence all treat it as falsy, so it can never charge silently.
 */
export function resolveAddedLineAssurance(
  incoming: boolean | undefined,
  existing: { hasAssurance?: boolean } | undefined,
  policy: {
    smartCartProEnabled: boolean;
    merchantSlug: string | null | undefined;
    hasQuizVoucher?: boolean;
  }
): boolean | undefined {
  if (policy.hasQuizVoucher && incoming === undefined) return false;
  if (!existing) return incoming ?? resolveAssuranceDefault(policy);
  return incoming ?? existing.hasAssurance;
}

function resolveAssuranceDefault(policy: {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
}): boolean {
  return policy.smartCartProEnabled && policy.merchantSlug === 'ogabassey';
}
