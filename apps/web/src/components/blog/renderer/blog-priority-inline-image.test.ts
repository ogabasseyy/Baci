import { describe, expect, it, vi } from 'vitest';

const { mockIsTrusted, mockIsLegacy } = vi.hoisted(() => ({
  mockIsTrusted: vi.fn(),
  mockIsLegacy: vi.fn(),
}));

vi.mock('@/lib/blog-inline-image-optimization', () => ({
  isTrustedCdnInlineImage: (...args: unknown[]) => mockIsTrusted(...args),
  isLegacyOgabasseyCdnBlogImage: (...args: unknown[]) => mockIsLegacy(...args),
}));

import { findFirstTrustedInlineImage } from './blog-priority-inline-image';

const IMAGE_SRC = 'https://cdn.ogabassey.com/blog/inline/photo.png';

function docWithImage(src: string) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      { type: 'image', attrs: { src } },
    ],
  };
}

describe('findFirstTrustedInlineImage', () => {
  it('returns the first trusted inline image with its node path', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);

    expect(findFirstTrustedInlineImage(docWithImage(IMAGE_SRC), '0')).toEqual({
      src: IMAGE_SRC,
      nodePath: '0.1',
    });
  });

  it('returns null when the first image is not a trusted inline image', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(false);

    expect(
      findFirstTrustedInlineImage(docWithImage(IMAGE_SRC), '0')
    ).toBeNull();
  });

  it('returns null when the first image does not match the target src', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);

    expect(
      findFirstTrustedInlineImage(
        docWithImage(IMAGE_SRC),
        '0',
        'https://cdn.ogabassey.com/blog/inline/other.png'
      )
    ).toBeNull();
  });

  it('returns null for documents without images', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);

    expect(
      findFirstTrustedInlineImage(
        { type: 'doc', content: [{ type: 'paragraph' }] },
        '0'
      )
    ).toBeNull();
  });

  it('treats content-addressed release media as the first renderable image and returns null', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);
    const releaseSrc = `/release-assets/${'a'.repeat(64)}.webp`;

    expect(
      findFirstTrustedInlineImage(docWithImage(releaseSrc), '0')
    ).toBeNull();
  });

  it('does not skip an earlier release asset to prioritize a subsequent trusted CDN image', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);
    const releaseSrc = `/release-assets/${'a'.repeat(64)}.webp`;
    const docWithBoth = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: releaseSrc } },
        { type: 'image', attrs: { src: IMAGE_SRC } },
      ],
    };

    // The first rendered image is the release asset (not a trusted CDN image), so it must
    // return null rather than prioritizing the second image at 0.1.
    expect(findFirstTrustedInlineImage(docWithBoth, '0')).toBeNull();
  });

  it('skips non-canonical release asset paths and finds the next valid trusted image', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);
    const invalidReleaseSrc = `/release-assets/${'a'.repeat(63)}.webp`;
    const docWithInvalidFirst = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: invalidReleaseSrc } },
        { type: 'image', attrs: { src: IMAGE_SRC } },
      ],
    };

    expect(findFirstTrustedInlineImage(docWithInvalidFirst, '0')).toEqual({
      src: IMAGE_SRC,
      nodePath: '0.1',
    });
  });
});
