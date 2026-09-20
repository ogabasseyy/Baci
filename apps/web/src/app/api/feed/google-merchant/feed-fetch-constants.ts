// Batching bounds for feed hydration: the smaller RPC batches reduce DB
// work per call, while limited parallelism prevents cold public feeds
// from serializing up to 200 round trips for max-size merchant catalogs.
export const FEED_FETCH_CONSTANTS = {
  VARIANTS_BATCH_SIZE: 50,
  VARIANTS_MAX_CONCURRENT_BATCHES: 4,
} as const;
