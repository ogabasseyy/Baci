import { describe, expect, it } from 'vitest';
import { readPlatformPatchError } from './platform-blog-post-patch-error';

describe('readPlatformPatchError', () => {
  it('maps a missing locked row to not-found', () => {
    expect(
      readPlatformPatchError({
        code: 'P0002',
        message: 'platform_blog_post_not_found',
      })
    ).toEqual({ error: 'Post not found', status: 404 });
  });

  it('maps a slug collision to conflict', () => {
    expect(readPlatformPatchError({ code: '23505' })).toEqual({
      error: 'A post with this slug already exists',
      status: 409,
    });
  });

  it('maps a swept-media abort to the removed-media message', () => {
    expect(
      readPlatformPatchError({
        code: 'P0001',
        message: 'platform_blog_media_swept_during_save: platform/blog/x.webp',
      })
    ).toEqual({
      error: 'Referenced media was removed during save',
      status: 500,
    });
  });

  it('maps unknown failures to the generic message', () => {
    expect(readPlatformPatchError({ code: '22023' })).toEqual({
      error: 'Failed to update platform blog post',
      status: 500,
    });
    expect(readPlatformPatchError(null)).toEqual({
      error: 'Failed to update platform blog post',
      status: 500,
    });
  });
});
