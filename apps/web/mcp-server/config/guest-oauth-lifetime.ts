/** Authorization can renew; a cart and its contents never inherit that renewal. */
export const GUEST_CONNECTION_IDLE_TTL = 90 * 86400_000;
export const GUEST_CART_TTL = 7 * 86400_000;
export const GUEST_CLOCK_MARGIN = 5 * 60_000;
// Refresh handles encode a 32-bit generation. Per-tenant database admission
// and expiring access records bound storage independently of connection age.
export const GUEST_REFRESH_MAX_GENERATION = 0xffff_ffff;
