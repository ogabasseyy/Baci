import { randomBytes } from 'node:crypto';
import type { GuestOAuth } from './guest-oauth';
import { GUEST_CART_TTL, GUEST_CLOCK_MARGIN } from './config/guest-oauth-lifetime';

export class GuestOAuthGrantConflict extends Error {
  constructor() { super('temporarily_unavailable'); }
}

/** CAS selects one new empty cart handle; expired carts are never extended/copied. */
export async function currentGuestCart(auth: GuestOAuth, token: string, now: number) {
  for (let retry = 0; retry < 3; retry++) {
    const grant = await auth.verify(token);
    if ((grant.cartExpiresAt ?? grant.expiresAt) > now) return grant;
    try {
      return await auth.updateGrant(grant.id, (current) => {
        if ((current.cartExpiresAt ?? current.expiresAt) > now) return current;
        return {
          ...current,
          cartToken: randomBytes(32).toString('hex'),
          cartInitialized: false,
          cartExpiresAt: Math.min(now + GUEST_CART_TTL - GUEST_CLOCK_MARGIN, current.expiresAt),
        };
      });
    } catch (error) {
      if (!(error instanceof GuestOAuthGrantConflict)) throw error;
      // Concurrent refresh/rollover can win; revalidate revocation and read its handle.
      if (retry === 2) throw new Error('temporarily_unavailable');
    }
  }
  throw new Error('temporarily_unavailable');
}
