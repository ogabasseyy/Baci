import 'server-only';

/**
 * THE checkout ownership rule, stated once for every TypeScript layer.
 *
 * Ownership binds the six immutable IDs below — never the profile email.
 * The email may change after initialization, and comparing it on the
 * recovery path would strand unresolved or already-charged checkouts for
 * both the provider webhook (original address) and the client (new
 * address). The stored checkout email is still compared as provider
 * evidence at the collection boundary, and initialization (which binds
 * the email at creation) still requires the stored address to match the
 * confirmed one. Status recovery binds IDs only.
 *
 * The database mirrors this rule in
 * piggyvest_primary_card.assert_scope (scope IDs against the customer
 * row; the scope email is carried but never compared — migration
 * 091200 dropped it from authorization for the same recovery reason).
 * SQL cannot import this module, so the mirror is pinned by contract
 * instead: the checkout integration chain's ownership-conformance block
 * fails if authorization ever enforces a different field list — in
 * either direction, including silently re-adding email. Change the rule
 * here and there together.
 */
export const CHECKOUT_OWNERSHIP_ID_KEYS = [
  'environment',
  'integrationId',
  'merchantId',
  'customerId',
  'userId',
  'businessId',
] as const;

export type CheckoutOwnershipIdKey =
  (typeof CHECKOUT_OWNERSHIP_ID_KEYS)[number];

type OwnershipCompared = Record<CheckoutOwnershipIdKey, unknown> & {
  [key: string]: unknown;
};

export function assertCheckoutIntentOwnership(
  scope: OwnershipCompared,
  intent: OwnershipCompared
): void {
  if (CHECKOUT_OWNERSHIP_ID_KEYS.some((key) => intent[key] !== scope[key]))
    throw new Error('Primary card identity unavailable');
}

export function isCheckoutRouteOwner(input: {
  action: 'initialize' | 'status';
  settingsMerchantId: string;
  authUserId: string;
  authEmail: string;
  identity: { merchant_id: string; user_id: string; email: string };
}): boolean {
  if (input.identity.merchant_id !== input.settingsMerchantId) return false;
  if (input.identity.user_id !== input.authUserId) return false;
  // Initialize-only: the checkout email is bound at creation, so a
  // changed address must not initialize against another customer's row.
  // Status binds IDs only (see module comment).
  if (
    input.action === 'initialize' &&
    input.identity.email.toLowerCase() !== input.authEmail.toLowerCase()
  )
    return false;
  return true;
}
