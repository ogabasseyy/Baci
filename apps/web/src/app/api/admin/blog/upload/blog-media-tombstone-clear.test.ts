import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlogPostMediaRow } from './blog-media-reference-scan';
import { blogPostMediaPaths } from './blog-media-tombstone-clear';

const COVER = 'https://cdn.example.com/media/platform/blog/cover.webp';
const INLINE = 'https://cdn.example.com/media/platform/blog/inline-1.png';

function row(overrides: Partial<BlogPostMediaRow> = {}): BlogPostMediaRow {
  return { ...overrides };
}

describe('blogPostMediaPaths', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('collects URLs across the media-carrying columns', () => {
    expect(
      blogPostMediaPaths(
        row({ content: `<img src="${INLINE}">`, featured_image_url: COVER })
      ).sort()
    ).toEqual(['platform/blog/cover.webp', 'platform/blog/inline-1.png']);
  });

  it('trims markdown closing delimiters and prose punctuation', () => {
    expect(
      blogPostMediaPaths(row({ content: `![alt](${INLINE}) see ${COVER}.` }))
    ).toEqual(['platform/blog/inline-1.png', 'platform/blog/cover.webp']);
  });

  it('matches JSON-escaped URLs', () => {
    const escaped = `https:\\/\\/cdn.example.com\\/media\\/platform\\/blog\\/inline-1.png`;
    expect(blogPostMediaPaths(row({ content: escaped }))).toEqual([
      'platform/blog/inline-1.png',
    ]);
  });

  it('matches named-entity-spelled URLs', () => {
    const spelled =
      'https&colon;&sol;&sol;cdn&period;example&period;com&sol;media&sol;platform&sol;blog&sol;inline-1&period;png';
    expect(blogPostMediaPaths(row({ content: spelled }))).toEqual([
      'platform/blog/inline-1.png',
    ]);
  });

  it('serializes object variants before matching', () => {
    expect(
      blogPostMediaPaths(row({ featured_image_variants: { a: INLINE } }))
    ).toEqual(['platform/blog/inline-1.png']);
  });

  it('matches string variants directly', () => {
    expect(
      blogPostMediaPaths(row({ featured_image_variants: `["${COVER}"]` }))
    ).toEqual(['platform/blog/cover.webp']);
  });

  it('dedupes repeated references and skips non-strings', () => {
    expect(blogPostMediaPaths(row({ content: COVER, excerpt: COVER }))).toEqual(
      ['platform/blog/cover.webp']
    );
    expect(blogPostMediaPaths(row({}))).toEqual([]);
  });
});
