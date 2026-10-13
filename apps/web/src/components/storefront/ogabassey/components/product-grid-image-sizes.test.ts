import { describe, expect, it } from 'vitest';
import { HOME_PRODUCT_GRID_CARD_IMAGE_SIZES } from './product-grid-image-sizes';

describe('product-grid-image-sizes', () => {
  it('exposes a mobile-first sizes ladder for home product cards', () => {
    // Shared by the static fallback, the interactive card, and the parity
    // suite: a single source so all three resolve byte-identical candidates.
    expect(HOME_PRODUCT_GRID_CARD_IMAGE_SIZES).toContain('40vw');
    expect(HOME_PRODUCT_GRID_CARD_IMAGE_SIZES).toContain('20vw');
  });
});
