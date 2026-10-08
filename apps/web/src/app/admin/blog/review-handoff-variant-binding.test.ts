import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { variantBindsToSource } from './review-handoff-variant-binding';

const ORIGIN = DEFAULT_BLOG_MEDIA_CDN_ORIGIN;
const managedSource = `${ORIGIN}/media/platform/blog/aaaa.jpg`;
const codexSource = `${ORIGIN}/core-assets/blog/codex/article-a/galaxy-a.jpg`;

describe('variantBindsToSource', () => {
  it.each([
    [
      'same-token managed variant',
      `${ORIGIN}/media/platform/blog/aaaa/landscape_16x9.webp`,
      'landscape_16x9',
      managedSource,
      true,
    ],
    [
      'foreign-token managed variant',
      `${ORIGIN}/media/platform/blog/bbbb/landscape_16x9.webp`,
      'landscape_16x9',
      managedSource,
      false,
    ],
    [
      'generated variant with managed source',
      `${ORIGIN}/core-assets/blog/codex/article-a/galaxy-a-landscape_16x9.jpg`,
      'landscape_16x9',
      managedSource,
      false,
    ],
    [
      'same-article generated variant',
      `${ORIGIN}/core-assets/blog/codex/article-a/galaxy-a-landscape_16x9.jpg`,
      'landscape_16x9',
      codexSource,
      true,
    ],
    [
      'other-article generated variant',
      `${ORIGIN}/core-assets/blog/codex/article-b/galaxy-b-landscape_16x9.jpg`,
      'landscape_16x9',
      codexSource,
      false,
    ],
    [
      'same-article generated variant under a transform prefix',
      `${ORIGIN}/image/format=auto/core-assets/blog/codex/article-a/galaxy-a-landscape_16x9.jpg`,
      'landscape_16x9',
      `${ORIGIN}/image/format=auto/core-assets/blog/codex/article-a/galaxy-a.jpg`,
      true,
    ],
    [
      'managed variant with generated source',
      `${ORIGIN}/media/platform/blog/aaaa/landscape_16x9.webp`,
      'landscape_16x9',
      codexSource,
      false,
    ],
    [
      'managed variant with foreign source',
      `${ORIGIN}/media/platform/blog/aaaa/landscape_16x9.webp`,
      'landscape_16x9',
      'https://cdn.example.com/galaxy-a.webp',
      true,
    ],
    [
      'generated variant with foreign source',
      `${ORIGIN}/core-assets/blog/codex/article-a/galaxy-a-landscape_16x9.jpg`,
      'landscape_16x9',
      'https://cdn.example.com/galaxy-a.webp',
      true,
    ],
  ])('%s', (_label, variantUrl, variantKey, sourceUrl, expected) => {
    expect(variantBindsToSource(variantUrl, variantKey, sourceUrl)).toBe(
      expected
    );
  });
});
