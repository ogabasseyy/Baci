import { describe, expect, it } from 'vitest';
import {
  BLOG_MEDIA_TOMBSTONE_GRACE_MS,
  BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT,
  BLOG_MEDIA_TOMBSTONE_TABLE,
} from './blog-media-tombstone-constants';

describe('blog media tombstone constants', () => {
  it('names the staged-deletion table with an hourly grace window', () => {
    expect(BLOG_MEDIA_TOMBSTONE_TABLE).toBe('blog_media_delete_tombstones');
    expect(BLOG_MEDIA_TOMBSTONE_GRACE_MS).toBe(60 * 60 * 1000);
    expect(BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT).toBeGreaterThan(0);
  });
});
