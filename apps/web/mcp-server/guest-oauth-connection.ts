import type { GuestOAuth } from './guest-oauth';
import type { GuestCartStore } from './guest-cart-store';

/** Every call revalidates connection authority; tool/model fields cannot select a cart. */
export function createGuestOAuthConnection(
  auth: GuestOAuth,
  store: GuestCartStore,
  accessToken: string,
) {
  return {
    async resolveToken() {
      const grant = await auth.verify(accessToken);
      if (!grant.cartInitialized) {
        await store.initializeConnectionCart(
          grant.cartToken,
          new Date(grant.expiresAt).toISOString(),
        );
        try {
          await auth.updateGrant(grant.id, (current) => ({ ...current, cartInitialized: true }));
        } catch (error) {
          const latest = await auth.verify(accessToken);
          if (!latest.cartInitialized || latest.cartToken !== grant.cartToken) throw error;
        }
      }
      return grant.cartToken;
    },
  };
}
