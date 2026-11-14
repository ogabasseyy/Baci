import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLiveGrantOperations } from './grant-operations';
import type { CartPrincipal } from './principal';
import { getCart } from './service';

const verified = Symbol('server-authenticated-subject');
export interface VerifiedCustomerSubject {
  readonly [verified]: true;
  readonly id: string | null;
}
export async function verifyContinuitySubject(
  getUser: () => Promise<{
    data: { user: { id: string } | null };
    error: { name: string } | null;
  }>
): Promise<VerifiedCustomerSubject> {
  const result = await getUser();
  if (result.error && result.error.name !== 'AuthSessionMissingError')
    throw Error('AUTH_UNAVAILABLE');
  if (result.data.user && result.error) throw Error('AUTH_UNAVAILABLE');
  return { [verified]: true, id: result.data.user?.id ?? null };
}
/** Non-authorizing equality hint. No customer/grant identifiers are returned. */
export function resolveExperienceCartContinuity(
  principal: CartPrincipal,
  customer: VerifiedCustomerSubject
): string {
  if (
    !customer[verified] ||
    principal.scope !== 'session' ||
    !principal.cartId ||
    !principal.grantId
  )
    throw Error('INVALID_CONTINUITY');
  return createHash('sha256')
    .update(
      JSON.stringify([
        'baci-experience-cart/1',
        principal.merchantId,
        principal.cartId,
        principal.principalId,
        principal.grantId,
        customer.id ?? 'guest',
      ])
    )
    .digest('hex');
}
export async function loadExperienceCartContinuity(
  client: SupabaseClient,
  principal: CartPrincipal,
  customer: VerifiedCustomerSubject,
  now = Date.now()
): Promise<string | null> {
  const live = await loadLiveGrantOperations(client, principal);
  if (
    !live ||
    Date.parse(live.grantExpiresAt) <= now ||
    Date.parse(principal.expiresAt) <= now
  )
    return null;
  const cart = await getCart({ client, principal });
  if (
    !cart.ok ||
    cart.cart.cartId !== principal.cartId ||
    cart.cart.merchantId !== principal.merchantId
  )
    return null;
  return resolveExperienceCartContinuity(principal, customer);
}
