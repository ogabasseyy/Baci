import { describe, expect, it } from 'vitest';
import { buildBlogPublisherSameAs } from './blog-publisher-same-as';

describe('buildBlogPublisherSameAs', () => {
  it('normalizes supported social URLs and ignores unsupported values', () => {
    expect(
      buildBlogPublisherSameAs({
        instagram: 'ogabassey',
        linkedin: 'https://www.linkedin.com/company/ogabassey',
        unknown: 'https://example.com/profile',
        youtube: null,
      })
    ).toEqual([
      'https://instagram.com/ogabassey',
      'https://www.linkedin.com/company/ogabassey',
    ]);
  });

  it('normalizes all supported platform fields', () => {
    expect(
      buildBlogPublisherSameAs({
        instagram: '@ogabassey',
        facebook: 'ogabassey',
        tiktok: 'ogabassey',
        twitter: 'ogabassey',
        youtube: 'ogabassey',
        linkedin: 'ogabassey',
        snapchat: 'ogabassey',
      })
    ).toEqual([
      'https://instagram.com/ogabassey',
      'https://facebook.com/ogabassey',
      'https://www.tiktok.com/@ogabassey',
      'https://x.com/ogabassey',
      'https://youtube.com/@ogabassey',
      'https://linkedin.com/company/ogabassey',
      'https://www.snapchat.com/@ogabassey',
    ]);
  });

  it('deduplicates duplicate normalized URLs', () => {
    expect(
      buildBlogPublisherSameAs({
        instagram: 'https://instagram.com/ogabassey',
        facebook: 'https://instagram.com/ogabassey',
      })
    ).toEqual(['https://instagram.com/ogabassey']);
  });

  it('returns an empty array when no usable social media data is present', () => {
    expect(buildBlogPublisherSameAs(null)).toEqual([]);
    expect(buildBlogPublisherSameAs(undefined)).toEqual([]);
    expect(buildBlogPublisherSameAs({})).toEqual([]);
    expect(
      buildBlogPublisherSameAs({
        instagram: '',
        facebook: '   ',
      })
    ).toEqual([]);
  });

  it('omits non-brand handles when a publisher identity is provided', () => {
    expect(
      buildBlogPublisherSameAs(
        {
          youtube: 'ogabassey',
          linkedin: 'ogabasseyy',
          tiktok: 'qynovx',
          twitter: 'sxgtow',
          instagram: 'ywzhqv',
        },
        'Ogabassey'
      )
    ).toEqual([
      'https://youtube.com/@ogabassey',
      'https://linkedin.com/company/ogabasseyy',
    ]);
  });
});
