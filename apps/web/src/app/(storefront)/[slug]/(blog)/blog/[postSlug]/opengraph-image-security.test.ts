import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  env: {
    // Deliberately distinct from DEFAULT_BLOG_MEDIA_CDN_ORIGIN so
    // the suite proves the default CDN stays trusted under an
    // override, matching the shared media trust set.
    NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN: 'https://cdn.override.example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  },
}));

import {
  getBlogCacheTag,
  isAllowedBlogOgImageUrl,
  isAllowedLogoUrl,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-security';

describe('merchant blog OG image security helpers', () => {
  it('builds the existing per-identifier blog cache tag', () => {
    expect(getBlogCacheTag(' OGABASSEY.COM ', ' Best-Deals ')).toMatch(
      /^blog-ogabassey\.com-best-deals-[a-f0-9]{32}$/
    );
  });

  it('requires both trusted origin and tenant-scoped blog path for featured images', () => {
    expect(
      isAllowedBlogOgImageUrl(
        'https://cdn.ogabassey.com/media/merchant-1/blog/raw.jpg',
        'merchant-1'
      )
    ).toBe(true);
    expect(
      isAllowedBlogOgImageUrl(
        'https://project.supabase.co/storage/v1/object/public/media/merchant-1/blog/upload-token/landscape_16x9.webp',
        'merchant-1'
      )
    ).toBe(true);
    expect(
      isAllowedBlogOgImageUrl(
        'https://evil.example.com/media/merchant-1/blog/raw.jpg',
        'merchant-1'
      )
    ).toBe(false);
    expect(
      isAllowedBlogOgImageUrl(
        'https://cdn.ogabassey.com/media/merchant-2/blog/raw.jpg',
        'merchant-1'
      )
    ).toBe(false);
    expect(
      isAllowedBlogOgImageUrl(
        'http://169.254.169.254/latest/meta-data/',
        'merchant-1'
      )
    ).toBe(false);
    expect(isAllowedBlogOgImageUrl('file:///etc/passwd', 'merchant-1')).toBe(
      false
    );
  });

  it('allows trusted platform-blog paths only when the platform scope is provided', () => {
    const platformUrl =
      'https://cdn.ogabassey.com/media/platform/blog/launch-faster.png';

    expect(isAllowedBlogOgImageUrl(platformUrl, { kind: 'platform' })).toBe(
      true
    );
    expect(isAllowedBlogOgImageUrl(platformUrl, 'merchant-1')).toBe(false);
  });

  it('trusts the deploy override CDN alongside the default', () => {
    expect(
      isAllowedBlogOgImageUrl(
        'https://cdn.override.example.com/media/platform/blog/launch-faster.png',
        { kind: 'platform' }
      )
    ).toBe(true);
    expect(
      isAllowedBlogOgImageUrl(
        'https://cdn.override.example.com/media/merchant-1/blog/raw.jpg',
        'merchant-1'
      )
    ).toBe(true);
  });

  it('allows logos only from trusted HTTPS origins', () => {
    expect(
      isAllowedLogoUrl('https://cdn.ogabassey.com/media/merchant-2/logo.png')
    ).toBe(true);
    expect(
      isAllowedLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/media/merchant-2/logo.png'
      )
    ).toBe(true);
    expect(isAllowedLogoUrl('https://usebaci.com/logo.png')).toBe(true);
    expect(isAllowedLogoUrl('https://evil.example.com/logo.png')).toBe(false);
    expect(isAllowedLogoUrl('http://cdn.ogabassey.com/logo.png')).toBe(false);
  });
});
