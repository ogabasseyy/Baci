import {
  CART_FULL_SESSION_OPERATIONS,
  type CartCommand,
} from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartPrincipal } from './principal';

const KNOWN_OPERATIONS: ReadonlySet<string> = new Set(
  CART_FULL_SESSION_OPERATIONS
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface LiveGrantAuthority {
  allowedOperations: CartCommand['type'][];
  grantExpiresAt: string;
}

/**
 * Loads the live grant's stored operations and authoritative expiry
 * for a session principal. Returns null when the grant is not live
 * for this principal or the reply is malformed; callers fail closed
 * rather than guessing.
 */
export async function loadLiveGrantOperations(
  client: SupabaseClient,
  principal: CartPrincipal
): Promise<LiveGrantAuthority | null> {
  if (principal.scope !== 'session' || !principal.cartId || !principal.grantId)
    return null;
  const response = await client.rpc('commerce_cart_grant_operations');
  if (response.error || !isRecord(response.data)) return null;
  const data = response.data;
  if (data.ok !== true || !Array.isArray(data.allowedOperations)) return null;
  if (
    typeof data.grantExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(data.grantExpiresAt))
  )
    return null;
  const operations: CartCommand['type'][] = [];
  for (const operation of data.allowedOperations) {
    if (typeof operation !== 'string' || !KNOWN_OPERATIONS.has(operation))
      return null;
    operations.push(operation as CartCommand['type']);
  }
  return { allowedOperations: operations, grantExpiresAt: data.grantExpiresAt };
}

/**
 * Upgrades a principal whose proof predates the operations claim by
 * loading the live grant's verified operations. Principals whose
 * proof already claims its operations pass through unchanged; a
 * legacy principal whose grant cannot be verified returns null.
 */
export async function upgradeLegacySessionPrincipal(
  client: SupabaseClient,
  principal: CartPrincipal
): Promise<CartPrincipal | null> {
  if (principal.scope !== 'session' || principal.operationsClaimPresent)
    return principal;
  const liveGrant = await loadLiveGrantOperations(client, principal);
  if (!liveGrant) return null;
  return {
    ...principal,
    allowedOperations: liveGrant.allowedOperations,
    liveGrantExpiresAt: liveGrant.grantExpiresAt,
    operationsClaimPresent: true,
  };
}
