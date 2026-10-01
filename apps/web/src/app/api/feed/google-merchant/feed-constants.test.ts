import { expect, it } from 'vitest';
import { FEED_CONSTANTS } from './feed-constants';

it('keeps the feed stock sentinel and title boundary stable', () => {
  expect(FEED_CONSTANTS.UNLIMITED_STOCK_QUANTITY).toBe(9999);
  expect(FEED_CONSTANTS.TITLE_MAX_LENGTH).toBe(150);
});
