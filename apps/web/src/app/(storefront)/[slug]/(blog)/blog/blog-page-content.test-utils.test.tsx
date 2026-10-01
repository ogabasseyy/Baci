import { describe, expect, it } from 'vitest';
import {
  buildListingResult,
  merchant,
  postsPayload,
} from './blog-page-content.test-utils';

describe('blog-page-content test fixtures', () => {
  it('builds a listing result from the shared merchant and post fixtures', () => {
    expect(buildListingResult()).toEqual(
      expect.objectContaining({
        merchant,
        posts: postsPayload,
        totalPosts: postsPayload.length,
      })
    );
  });
});
