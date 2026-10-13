import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTrustedBlogImageOrigins } from './get-trusted-blog-image-origins';

describe('getTrustedBlogImageOrigins', () => {
  afterEach(vi.unstubAllEnvs);

  it('trusts the override, the default CDN, and Supabase Storage', () => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.new.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://mock.supabase.co');

    expect(getTrustedBlogImageOrigins().sort()).toEqual(
      [
        'https://cdn.new.test',
        'https://cdn.ogabassey.com',
        'https://mock.supabase.co',
      ].sort()
    );
  });

  it('keeps the default when nothing is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');

    expect(getTrustedBlogImageOrigins()).toEqual(['https://cdn.ogabassey.com']);
  });

  it('skips malformed origins without dropping the default', () => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', ':::not a url:::');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'also bad');

    expect(getTrustedBlogImageOrigins()).toEqual(['https://cdn.ogabassey.com']);
  });
});
