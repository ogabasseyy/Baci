import { describe, expect, it } from 'vitest';
import { PLATFORM_BLOG_DETAIL_SELECT } from './platform-blog-post-route-schema';

describe('PLATFORM_BLOG_DETAIL_SELECT', () => {
  it('uses an explicit platform post projection', () => {
    expect(PLATFORM_BLOG_DETAIL_SELECT).toContain('id, title, slug');
    expect(PLATFORM_BLOG_DETAIL_SELECT).not.toContain('*');
  });
});
