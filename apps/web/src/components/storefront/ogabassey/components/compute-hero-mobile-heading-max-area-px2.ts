import {
  HERO_MOBILE_SECTION_HORIZONTAL_PADDING_PX,
  HERO_MOBILE_TEXT_COLUMN_HORIZONTAL_PADDING_PX,
  HERO_MOBILE_TITLE_FONT_SIZE_PX,
  HERO_MOBILE_TITLE_LINE_HEIGHT_RATIO,
  HERO_MOBILE_TITLE_MAX_LINES,
} from './hero-mobile-geometry';

export function computeHeroMobileHeadingMaxAreaPx2(
  viewportWidthPx: number
): number {
  const panelWidthPx = Math.max(
    0,
    viewportWidthPx - HERO_MOBILE_SECTION_HORIZONTAL_PADDING_PX
  );
  const textColumnWidthPx = Math.max(
    0,
    panelWidthPx * (3 / 5) - HERO_MOBILE_TEXT_COLUMN_HORIZONTAL_PADDING_PX
  );
  const maxHeadingHeightPx =
    HERO_MOBILE_TITLE_MAX_LINES *
    HERO_MOBILE_TITLE_FONT_SIZE_PX *
    HERO_MOBILE_TITLE_LINE_HEIGHT_RATIO;
  return textColumnWidthPx * maxHeadingHeightPx;
}
