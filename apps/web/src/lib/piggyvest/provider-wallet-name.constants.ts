/**
 * Longest `subaccount_name` PiggyVest's POST /api/v1/wallet/sub-account
 * accepts: 51 or more characters is refused with HTTP 422 "One or more
 * validation errors occurred" (staging sandbox probe, 2026-10-31).
 */
export const PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS = 50;
