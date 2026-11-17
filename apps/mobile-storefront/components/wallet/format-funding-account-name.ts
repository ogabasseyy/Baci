/**
 * The bank returns a PiggyVest account name as "<business>/<customer>"
 * ("Ogabassey Services Limited/Bassey John"). Customers read their own name
 * first, then the store's short name: "Bassey John / Ogabassey" (owner,
 * 2026-11-16). Only the first "/" splits, so a customer name containing "/"
 * stays whole. Anything else (no "/", an empty side, no store name) is shown
 * exactly as returned.
 */
export function formatFundingAccountName(
  accountName: string,
  storeName: string | null | undefined
): string {
  const slash = accountName.indexOf('/');
  const store = storeName?.trim() ?? '';
  if (slash < 0 || store === '') return accountName;
  const business = accountName.slice(0, slash).trim();
  const customer = accountName.slice(slash + 1).trim();
  if (business === '' || customer === '') return accountName;
  return `${customer} / ${store}`;
}
