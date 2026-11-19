export const BRILSTASH_FEED_PATH = '/partners/yield/brilpay/products';

// Keep this in sync with the pilot-slot, generation payload and
// first-activation checks in the BrilStash migrations.
export const BRILSTASH_PILOT_LISTING_LIMIT = 7;

// Match the database reader's live page rules and the handoff probe URL check.
export const BRILSTASH_FULL_FEED_QUERY = {
  page: 1,
  limit: 100,
  min_price: 0,
} as const;

export const BRILSTASH_JSON_MAX_BYTES = 256 * 1024;
