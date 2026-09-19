import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RENDERED_IMAGE_COUNT,
  PRODUCTS_PER_PAGE,
  useFallbackSwapPage,
} from './home-product-grid-fallback-swap';

describe('useFallbackSwapPage', () => {
  it('starts on the initial slice without a replay', () => {
    const { result } = renderHook(() =>
      useFallbackSwapPage({
        initialDisplayCount: 8,
        replayLoadMore: false,
        matchFallbackImageTier: false,
      })
    );

    expect(result.current.displayCount).toBe(8);
  });

  it('replays a captured load-more tap by expanding the first page', () => {
    const { result } = renderHook(() =>
      useFallbackSwapPage({
        initialDisplayCount: 8,
        replayLoadMore: true,
        matchFallbackImageTier: false,
      })
    );

    expect(result.current.displayCount).toBe(8 + PRODUCTS_PER_PAGE);
  });

  it('keeps only fallback-rendered images on the JPEG tier', () => {
    // The default fallback renders real images for the leading slice
    // only (placeholders below); those indices must not select the AVIF
    // tier or the browser downloads them a second time. Placeholder and
    // load-more indices keep AVIF. Both card branches share this
    // predicate.
    const { result } = renderHook(() =>
      useFallbackSwapPage({
        initialDisplayCount: 8,
        replayLoadMore: false,
        matchFallbackImageTier: true,
      })
    );

    expect(
      result.current.isFallbackTierIndex(FALLBACK_RENDERED_IMAGE_COUNT - 1)
    ).toBe(true);
    expect(
      result.current.isFallbackTierIndex(FALLBACK_RENDERED_IMAGE_COUNT)
    ).toBe(false);
    expect(result.current.isFallbackTierIndex(7)).toBe(false);
    expect(result.current.isFallbackTierIndex(8 + PRODUCTS_PER_PAGE)).toBe(
      false
    );
  });

  it('keeps the AVIF tier everywhere without the gate flag', () => {
    const { result } = renderHook(() =>
      useFallbackSwapPage({
        initialDisplayCount: 8,
        replayLoadMore: false,
        matchFallbackImageTier: false,
      })
    );

    expect(result.current.isFallbackTierIndex(0)).toBe(false);
    expect(result.current.isFallbackTierIndex(1)).toBe(false);
  });
});
