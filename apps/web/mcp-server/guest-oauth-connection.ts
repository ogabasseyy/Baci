import type { GuestOAuth } from './guest-oauth';

/** Every call revalidates connection authority; tool/model fields cannot select a cart. */
export function createGuestOAuthConnection(
  auth: GuestOAuth,
  store: { initializeConnectionCart(token: string, expiresAt: string): Promise<void> },
  accessToken: string,
) {
  return {
    async resolveToken() {
      const grant = await auth.currentCart(accessToken);
      if (!grant.cartInitialized) {
        await store.initializeConnectionCart(
          grant.cartToken,
          new Date(grant.cartExpiresAt ?? grant.expiresAt).toISOString(),
        );
        try {
          await auth.updateGrant(grant.id, (current) => {
            if (current.cartToken !== grant.cartToken) throw new Error('temporarily_unavailable');
            return { ...current, cartInitialized: true };
          });
        } catch (error) {
          // A rotated access token cannot disambiguate the original CAS failure.
          const latest = await auth.verify(accessToken).catch(() => { throw error; });
          if (!latest.cartInitialized || latest.cartToken !== grant.cartToken) throw error;
        }
      }
      return grant.cartToken;
    },
  };
}
