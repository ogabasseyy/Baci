import { describe, expect, it } from 'vitest';
import { applyCoverUrlChange } from './apply-cover-url-change';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogCoverState,
  type PlatformAdminBlogFormState,
} from './blog-types';

const COVER_A = 'https://cdn.example.com/cover-a.webp';
const COVER_X = 'https://cdn.example.com/cover-x.webp';
const VARIANTS_A = {
  landscape_16x9: 'https://cdn.example.com/cover-a-16x9.webp',
};

function formAt(
  url: string,
  overrides: Partial<PlatformAdminBlogFormState> = {}
) {
  return {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_url: url,
    ...overrides,
  };
}

function initialCover(): PlatformAdminBlogCoverState {
  return {
    alt: 'Cover A',
    altEdited: false,
    height: 675,
    url: COVER_A,
    variants: VARIANTS_A,
    width: 1200,
  };
}

describe('applyCoverUrlChange', () => {
  it('stashes the pre-diversion record when leaving the cover URL', () => {
    const coverStashRef = { current: null };
    const next = applyCoverUrlChange({
      coverStashRef,
      current: formAt(COVER_A, {
        featured_image_alt: 'Edited alt',
        featured_image_alt_edited: true,
        featured_image_height: 675,
        featured_image_variants: VARIANTS_A,
        featured_image_width: 1200,
      }),
      initialCover: initialCover(),
      nextUrl: COVER_X,
    });
    expect(next).toMatchObject({
      featured_image_alt: '',
      featured_image_height: null,
      featured_image_url: COVER_X,
      featured_image_variants: {},
      featured_image_width: null,
    });
    expect(coverStashRef.current).toMatchObject({
      alt: 'Edited alt',
      altEdited: true,
      url: COVER_A,
    });
  });

  it('restores the stashed alt edit when the URL diversion is undone', () => {
    const coverStashRef = { current: null };
    const diverted = applyCoverUrlChange({
      coverStashRef,
      current: formAt(COVER_A, {
        featured_image_alt: 'Edited alt',
        featured_image_alt_edited: true,
        featured_image_height: 675,
        featured_image_variants: VARIANTS_A,
        featured_image_width: 1200,
      }),
      initialCover: initialCover(),
      nextUrl: COVER_X,
    });
    const restored = applyCoverUrlChange({
      coverStashRef,
      current: diverted,
      initialCover: initialCover(),
      nextUrl: COVER_A,
    });
    expect(restored).toMatchObject({
      featured_image_alt: 'Edited alt',
      featured_image_alt_edited: true,
      featured_image_height: 675,
      featured_image_url: COVER_A,
      featured_image_variants: VARIANTS_A,
      featured_image_width: 1200,
    });
    expect(coverStashRef.current).toBeNull();
  });

  it('keeps the original stash across chained diversions', () => {
    const coverStashRef = { current: null };
    const coverY = 'https://cdn.example.com/cover-y.webp';
    const args = { coverStashRef, initialCover: initialCover() };
    const atX = applyCoverUrlChange({
      ...args,
      current: formAt(COVER_A, { featured_image_alt: 'Edited alt' }),
      nextUrl: COVER_X,
    });
    const atY = applyCoverUrlChange({ ...args, current: atX, nextUrl: coverY });
    expect(coverStashRef.current).toMatchObject({
      alt: 'Edited alt',
      url: COVER_A,
    });
    const restored = applyCoverUrlChange({
      ...args,
      current: atY,
      nextUrl: COVER_A,
    });
    expect(restored).toMatchObject({
      featured_image_alt: 'Edited alt',
      featured_image_url: COVER_A,
    });
  });

  it('restores the pristine cover when no diversion was stashed', () => {
    const restored = applyCoverUrlChange({
      coverStashRef: { current: null },
      current: formAt(COVER_X),
      initialCover: initialCover(),
      nextUrl: COVER_A,
    });
    expect(restored).toMatchObject({
      featured_image_alt: 'Cover A',
      featured_image_height: 675,
      featured_image_url: COVER_A,
      featured_image_width: 1200,
    });
  });

  it('leaves diverted metadata alone for whitespace-only URL edits', () => {
    const coverStashRef = { current: null };
    const args = { coverStashRef, initialCover: initialCover() };
    const atX = applyCoverUrlChange({
      ...args,
      current: formAt(COVER_A, { featured_image_alt: 'Cover A' }),
      nextUrl: COVER_X,
    });
    const typedX = {
      ...atX,
      featured_image_alt: 'X alt',
      featured_image_alt_edited: true,
    };
    const next = applyCoverUrlChange({
      ...args,
      current: typedX,
      nextUrl: `${COVER_X} `,
    });
    expect(next).toMatchObject({
      featured_image_alt: 'X alt',
      featured_image_alt_edited: true,
      featured_image_url: `${COVER_X} `,
    });
    expect(coverStashRef.current).toMatchObject({ url: COVER_A });
  });
});
