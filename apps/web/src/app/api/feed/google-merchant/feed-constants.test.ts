import { expect, it } from 'vitest';
import {
  FEED_TITLE_MAX_LENGTH,
  UNLIMITED_STOCK_QUANTITY,
} from './feed-constants';

it('keeps the feed stock sentinel and title boundary stable', () => {
  expect(UNLIMITED_STOCK_QUANTITY).toBe(9999);
  expect(FEED_TITLE_MAX_LENGTH).toBe(150);
});
