import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { TRUSTED_BLOG_IMAGE_ORIGINS } from './trusted-blog-image-origins';

afterEach(() => vi.unstubAllEnvs());

describe('TRUSTED_BLOG_IMAGE_ORIGINS', () => {
  it('trusts the default CDN origin', () => {
    expect(
      TRUSTED_BLOG_IMAGE_ORIGINS.has(
        new URL(DEFAULT_BLOG_MEDIA_CDN_ORIGIN).origin
      )
    ).toBe(true);
  });

  it('trusts the deploy CDN origin override', () => {
    const override = process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;
    if (!override) {
      expect(TRUSTED_BLOG_IMAGE_ORIGINS.size).toBeGreaterThan(0);
      return;
    }
    expect(TRUSTED_BLOG_IMAGE_ORIGINS.has(new URL(override).origin)).toBe(true);
  });

  it('trusts the Supabase Storage origin for direct media URLs', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    const fresh = await import('./trusted-blog-image-origins');
    expect(
      fresh.TRUSTED_BLOG_IMAGE_ORIGINS.has('https://project.supabase.co')
    ).toBe(true);
  });
});
