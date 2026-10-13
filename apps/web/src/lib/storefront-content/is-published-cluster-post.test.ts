import { expect, it } from 'vitest';
import { isPublishedClusterPost } from './is-published-cluster-post';

it('accepts a complete published post shape and rejects malformed values', () => {
  expect(
    isPublishedClusterPost({
      slug: 'guide',
      title: 'Guide',
      excerpt: null,
      category: null,
      tags: [],
      keywords: [],
      featured_image_url: null,
      published_at: '2026-01-01',
      reading_time_minutes: 3,
    })
  ).toBe(true);
  expect(isPublishedClusterPost({ slug: '', title: 'Guide' })).toBe(false);
});
