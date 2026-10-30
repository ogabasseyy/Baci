import {
  HERO_MOBILE_IMAGE_COLUMN_PADDING_PX,
  HERO_MOBILE_IMAGE_ELEMENT_PADDING_PX,
  HERO_MOBILE_PANEL_HEIGHT_PX,
  HERO_MOBILE_SECTION_HORIZONTAL_PADDING_PX,
} from './hero-mobile-geometry';

/**
 * Computes the minimum painted area (`width * height` in CSS px²) of the square
 * `1:1` slide-0 hero `<img>` inside the mobile hero's 2-of-5 image column.
 */
export function computeHeroMobileImageMinAreaPx2(
  viewportWidthPx: number
): number {
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
  const squareSidePx = Math.min(contentWidthPx, contentHeightPx);
  return squareSidePx * squareSidePx;
}
