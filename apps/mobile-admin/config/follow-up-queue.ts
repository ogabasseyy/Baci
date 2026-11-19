/**
 * Tuning policy for the Customers > Follow Up queue.
 *
 * Kept out of the hook so the bounds can be adjusted without touching query
 * code, and so tests can derive their expectations from the same source.
 */

/**
 * Upper age bound on the follow-up queue.
 *
 * The queue had a minimum age but no maximum and no row cap, so it grew
 * without bound — an order abandoned months ago is not an actionable
 * follow-up, and every one of them was refetched on each open.
 *
 * Aged by `created_at`, not by the latest payment attempt. Checkout can
 * resume an existing order, so a new attempt can land on an old order — but
 * across all ogabassey history the largest order->latest-attempt gap is
 * 48.3 days (16 orders exceed 1 day, 5 exceed 7, none exceed 90), so this
 * window clears the observed maximum with ~1.9x headroom. Widening this
 * stays the mitigation if that ever changes; filtering on the embedded
 * transactions relation would need an `!inner` join that drops the many
 * follow-up orders having no attempt row at all.
 *
 * Tune here: at 90 days ogabassey keeps 135 of 145 open follow-ups.
 */
export const FOLLOW_UP_WINDOW_DAYS = 90;

/**
 * Hard ceiling on retained rows, independent of the window.
 * One extra order is fetched to detect overflow before email consolidation.
 *
 * PostgREST applies this before the client-side consolidation by email, so
 * the cap is on orders, not customers. That degrades safely: rows arrive
 * `created_at DESC`, so truncation always drops the least recently active
 * customers first and can only under-count `attempt_count` on those kept —
 * it can never rank a stale customer above a fresh one. Consolidating
 * server-side would need an aggregate/paginated endpoint; revisit if a
 * merchant ever exceeds this within the window (ogabassey is at 145).
 */
export const FOLLOW_UP_QUERY_LIMIT = 250;

/** Pending orders younger than this are still in flight, not abandoned. */
export const STALE_PENDING_MINUTES = 30;
