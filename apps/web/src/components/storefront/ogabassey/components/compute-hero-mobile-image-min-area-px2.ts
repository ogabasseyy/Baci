import {
  HERO_MOBILE_IMAGE_COLUMN_PADDING_PX,
  HERO_MOBILE_IMAGE_ELEMENT_PADDING_PX,
  HERO_MOBILE_PANEL_HEIGHT_PX,
  HERO_MOBILE_SECTION_HORIZONTAL_PADDING_PX,
} from './hero-mobile-geometry';

/**
 * Computes the visible `object-contain` painted area (`width * height` in CSS
 * px²) of the slide-0 hero `<img>` inside the mobile hero's 2-of-5 image column
 * for a given `width / height` aspect ratio (defaults to `1` for square product
 * renders).
 */
export function computeHeroMobileImageMinAreaPx2(
  viewportWidthPx: number,
  aspectRatio = 1
): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return 0;
  }
  const panelWidthPx = Math.max(
    0,
    viewportWidthPx - HERO_MOBILE_SECTION_HORIZONTAL_PADDING_PX
  );
  const imageColumnWidthPx = panelWidthPx * (2 / 5);
  const totalPaddingPx =
    HERO_MOBILE_IMAGE_COLUMN_PADDING_PX + HERO_MOBILE_IMAGE_ELEMENT_PADDING_PX;
  const contentWidthPx = Math.max(0, imageColumnWidthPx - totalPaddingPx);
  const contentHeightPx = Math.max(
    0,
    HERO_MOBILE_PANEL_HEIGHT_PX - totalPaddingPx
  );
  const visibleWidthPx = Math.min(
    contentWidthPx,
    contentHeightPx * aspectRatio
  );
  const visibleHeightPx = Math.min(
    contentHeightPx,
    contentWidthPx / aspectRatio
  );
  return visibleWidthPx * visibleHeightPx;
}
