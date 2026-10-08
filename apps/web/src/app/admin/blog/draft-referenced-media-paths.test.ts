import { describe, expect, it } from 'vitest';
import { draftReferencedMediaPaths } from './draft-referenced-media-paths';

const COVER = 'https://cdn.example.com/media/platform/blog/cover.webp';
const VARIANT =
  'https://cdn.example.com/media/platform/blog/cover/landscape_16x9.webp';
const INLINE = 'https://cdn.example.com/media/platform/blog/inline-1.png';
const SRCSET_A = 'https://cdn.example.com/media/platform/blog/a-1x.webp';
const SRCSET_B = 'https://cdn.example.com/media/platform/blog/a-2x.webp';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    content: '',
    featured_image_url: null,
    featured_image_variants: {},
    ...overrides,
  } as unknown as Parameters<typeof draftReferencedMediaPaths>[0];
}

describe('draftReferencedMediaPaths', () => {
  it('collects the cover and its variants', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          featured_image_url: COVER,
          featured_image_variants: { landscape_16x9: VARIANT },
        })
      )
    ).toEqual(
      new Set([
        'platform/blog/cover.webp',
        'platform/blog/cover/landscape_16x9.webp',
      ])
    );
  });

  it('collects body img src and srcset candidates', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          content: `<p>Body</p><img src="${INLINE}" srcset="${SRCSET_A} 1x, ${SRCSET_B} 2x">`,
        })
      )
    ).toEqual(
      new Set([
        'platform/blog/inline-1.png',
        'platform/blog/a-1x.webp',
        'platform/blog/a-2x.webp',
      ])
    );
  });

  it('ignores references hidden in comments', () => {
    expect(
      draftReferencedMediaPaths(
        draft({ content: `<!-- <img src="${INLINE}"> --><p>Body</p>` })
      )
    ).toEqual(new Set());
  });

  it('ignores references hidden in raw-text blocks', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          content: `<script>const s = "<img src=\\"${INLINE}\\">";</script>`,
        })
      )
    ).toEqual(new Set());
  });

  it('ignores foreign and malformed URLs', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          content: `<img src="https://other.example.com/a.png"><img src="not a url">`,
          featured_image_url: 'https://other.example.com/cover.png',
        })
      )
    ).toEqual(new Set());
  });

  it('tolerates missing fields and non-string values', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          featured_image_url: null,
          featured_image_variants: { landscape_16x9: null },
        })
      )
    ).toEqual(new Set());
  });

  it('dedupes paths referenced more than once', () => {
    expect(
      draftReferencedMediaPaths(
        draft({
          content: `<img src="${INLINE}"><img src="${INLINE}">`,
          featured_image_url: INLINE,
        })
      )
    ).toEqual(new Set(['platform/blog/inline-1.png']));
  });
});
