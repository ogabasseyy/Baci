/**
 * PiggyVest rewrites the wallet names it is given: a sandbox create with
 * `subaccount_name: "pvbproof-goal-..."` listed back with every `-`
 * removed (staging.piggyvest.business, 2026-10-31). The full rule (case,
 * spaces, other punctuation) is unknown, so names compare on lowercase
 * letters and digits only.
 *
 * This widens equality, so it can never choose between wallets: callers
 * must treat more than one match as ambiguous and fail closed. A name with
 * no letters or digits matches nothing.
 */

const providerWalletNameKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchesProviderWalletName(
  listed: string | null | undefined,
  expected: string
): boolean {
  const key = providerWalletNameKey(expected);
  return (
    key.length > 0 &&
    typeof listed === 'string' &&
    providerWalletNameKey(listed) === key
  );
}
