import { describe, expect, it } from 'vitest';
import {
  shouldHideCommittedBlogSnapshot,
  shouldHideLiveBlogFeaturedStory,
} from './should-hide-live-blog-featured-story';

describe('shouldHideLiveBlogFeaturedStory', () => {
  it('hides the live featured story only when it matches the committed snapshot', () => {
    expect(
      shouldHideLiveBlogFeaturedStory({
        liveFeaturedSlug: 'snapshot-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(true);
  });

  it('keeps the live featured story when the snapshot is stale or unpublished', () => {
    expect(
      shouldHideLiveBlogFeaturedStory({
        liveFeaturedSlug: 'newer-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(false);
  });
});

describe('shouldHideCommittedBlogSnapshot', () => {
  it('hides the committed snapshot when the live featured story has moved on', () => {
    expect(
      shouldHideCommittedBlogSnapshot({
        liveFeaturedSlug: 'newer-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(true);
  });

  it('keeps the committed snapshot when it still matches the live featured story', () => {
    expect(
      shouldHideCommittedBlogSnapshot({
        liveFeaturedSlug: 'snapshot-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(false);
  });
});
