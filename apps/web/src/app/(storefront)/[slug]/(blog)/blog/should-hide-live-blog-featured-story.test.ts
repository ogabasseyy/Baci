import { describe, expect, it } from 'vitest';
import {
  shouldHideCommittedBlogSnapshot,
  shouldHideLiveBlogFeaturedStory,
} from './should-hide-live-blog-featured-story';

describe('shouldHideLiveBlogFeaturedStory', () => {
  it('hides the live featured story whenever the snapshot hero is committed', () => {
    expect(
      shouldHideLiveBlogFeaturedStory({
        liveFeaturedSlug: 'snapshot-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(true);
    expect(
      shouldHideLiveBlogFeaturedStory({
        liveFeaturedSlug: 'newer-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(true);
  });

  it('keeps the live featured story on filtered or non-snapshot listings', () => {
    expect(
      shouldHideLiveBlogFeaturedStory({
        liveFeaturedSlug: 'newer-post',
        preferSnapshot: false,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(false);
  });
});

describe('shouldHideCommittedBlogSnapshot', () => {
  it('keeps the committed snapshot visible so live featured images cannot own LCP', () => {
    expect(
      shouldHideCommittedBlogSnapshot({
        liveFeaturedSlug: 'newer-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(false);
    expect(
      shouldHideCommittedBlogSnapshot({
        liveFeaturedSlug: 'snapshot-post',
        preferSnapshot: true,
        snapshotSlug: 'snapshot-post',
      })
    ).toBe(false);
  });
});
