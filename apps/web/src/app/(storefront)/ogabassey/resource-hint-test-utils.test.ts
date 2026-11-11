// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { hasRenderedResourceHintLink } from './resource-hint-test-utils';

describe('hasRenderedResourceHintLink', () => {
  it('matches a rendered resource hint by all requested attributes', () => {
    const html =
      '<link rel="preload" as="image" fetchpriority="high" href="/hero.avif">';

    expect(
      hasRenderedResourceHintLink(html, {
        as: 'image',
        fetchpriority: 'high',
        href: '/hero.avif',
        rel: 'preload',
      })
    ).toBe(true);
    expect(
      hasRenderedResourceHintLink(html, {
        as: 'image',
        href: '/other.avif',
        rel: 'preload',
      })
    ).toBe(false);
  });

  it('returns false when the rendered HTML is empty or contains no links', () => {
    const attributes = { href: '/hero.avif', rel: 'preload' };

    expect(hasRenderedResourceHintLink('', attributes)).toBe(false);
    expect(
      hasRenderedResourceHintLink('<section>Home content</section>', attributes)
    ).toBe(false);
  });

  it('returns false for empty attributes', () => {
    expect(
      hasRenderedResourceHintLink('<link rel="preload" href="/hero.avif">', {})
    ).toBe(false);
  });

  it('matches one fully matching link among multiple links', () => {
    const html = [
      '<link rel="stylesheet" href="/storefront.css">',
      '<link rel="preload" as="image" href="/hero.avif">',
      '<link rel="dns-prefetch" href="https://cdn.example.com">',
    ].join('');

    expect(
      hasRenderedResourceHintLink(html, {
        as: 'image',
        href: '/hero.avif',
        rel: 'preload',
      })
    ).toBe(true);
  });

  it('handles malformed HTML without throwing', () => {
    expect(() =>
      hasRenderedResourceHintLink('<link rel="preload" href="/hero.avif"', {
        href: '/hero.avif',
        rel: 'preload',
      })
    ).not.toThrow();
  });
});
