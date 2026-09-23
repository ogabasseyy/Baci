import { expect, it } from 'vitest';
import { FEED_FETCH_CONSTANTS } from './feed-fetch-constants';

it('keeps the feed hydration batching bounds stable', () => {
  expect(FEED_FETCH_CONSTANTS.VARIANTS_BATCH_SIZE).toBe(50);
  expect(FEED_FETCH_CONSTANTS.VARIANTS_MAX_CONCURRENT_BATCHES).toBe(4);
  expect(FEED_FETCH_CONSTANTS.MANIFEST_MAX_CONCURRENT_BATCHES).toBe(4);
});
