/**
 * Seconds a repair pickup-booking lock (`repairs.pickup_booking_lock_token`) is
 * treated as ACTIVE before it is considered stale. Shared by the claim RPC
 * caller (book-repair-pickup.ts) and the booking status route, which both need
 * the same staleness cutoff so a leaked lock from a failed pre-provider booking
 * cannot block terminal transitions forever. Must match the DB claim RPC's
 * default `p_lock_timeout_seconds` (migration 20260711171500).
 */
export const REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS = 15 * 60;

export const REPAIR_PICKUP_PROVIDER = 'GIGL' as const;

/**
 * Declared shipment value used for GIGL pickup quotes. Kept constant across the
 * storefront estimate, pre-payment quote, and post-payment booking so catalog
 * `quoted_price` snapshots cannot change the courier rate after the customer pays.
 */
export const REPAIR_PICKUP_DECLARED_VALUE = 50_000;
