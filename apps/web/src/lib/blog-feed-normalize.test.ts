import { describe, expect, it } from 'vitest';
import {
  normalizeBlogFeedPostForFilter,
  truncateFeedText,
  xmlSafeFeedImageUrl,
  xmlSafeFeedUrl,
} from './blog-feed-normalize';

describe('normalizeBlogFeedPostForFilter', () => {
  it('strips XML-forbidden characters from title, slug, and category', () => {
    expect(
      normalizeBlogFeedPostForFilter({
        title: 'Te\u001ast post',
        slug: 'agent-\u001aintegration-working',
        category: 'te\u001ast',
      })
    ).toEqual({
      title: 'Test post',
      slug: 'agent-integration-working',
      category: 'test',
    });
  });

  it('preserves a null category instead of coercing it', () => {
    expect(
      normalizeBlogFeedPostForFilter({
        title: 'Launch guide',
        slug: 'launch-guide',
        category: null,
      }).category
    ).toBeNull();
  });
});

describe('truncateFeedText', () => {
  it('keeps surrogate pairs intact at the cut boundary', () => {
    expect(truncateFeedText(`${'a'.repeat(299)}📱${'b'.repeat(10)}`, 300)).toBe(
      `${'a'.repeat(299)}📱`
    );
  });

  it('strips XML-forbidden characters before measuring length', () => {
    expect(truncateFeedText('ab\u001acd', 3)).toBe('abc');
  });
});

describe('xmlSafeFeedImageUrl', () => {
  it('preserves clean URLs and omits blank ones', () => {
    expect(xmlSafeFeedImageUrl('https://usebaci.com/logo.png')).toBe(
      'https://usebaci.com/logo.png'
    );
    expect(xmlSafeFeedImageUrl(null)).toBeUndefined();
    expect(xmlSafeFeedImageUrl(undefined)).toBeUndefined();
    expect(xmlSafeFeedImageUrl('')).toBeUndefined();
  });

  it('omits URLs that XML stripping would silently rewrite', () => {
    expect(
      xmlSafeFeedImageUrl('https://usebaci.com/image\u0008.png')
    ).toBeUndefined();
  });
});

describe('xmlSafeFeedUrl', () => {
  it('leaves well-formed URLs untouched', () => {
    expect(xmlSafeFeedUrl('https://usebaci.com/ogabassey/blog')).toBe(
      'https://usebaci.com/ogabassey/blog'
    );
  });

  it('percent-encodes control characters instead of deleting them', () => {
    expect(xmlSafeFeedUrl('https://usebaci.com/ogabassey\u001a/blog')).toBe(
      'https://usebaci.com/ogabassey%1A/blog'
    );
  });

  it('drops lone surrogates rather than throwing', () => {
    expect(
      xmlSafeFeedUrl(`https://usebaci.com/${String.fromCharCode(0xd800)}blog`)
    ).toBe('https://usebaci.com/blog');
  });
});
