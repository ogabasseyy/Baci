import { SPACING } from '@/constants/theme';

const STATUS_DRAWER_HEIGHT = 420;
const STATUS_DRAWER_HEADER_HEIGHT = 96;
const STATUS_DRAWER_ROW_HEIGHT = 64;
const STATUS_DRAWER_TOP_MARGIN = 24;

export function getStatusDrawerSnapPoints(
  windowHeight: number,
  topInset: number,
  contentRowCount: number
) {
  const maxHeight = Math.max(
    0,
    windowHeight - topInset - STATUS_DRAWER_TOP_MARGIN
  );
  const contentHeight =
    STATUS_DRAWER_HEADER_HEIGHT +
    SPACING.lg * 2 +
    Math.max(contentRowCount, 0) * STATUS_DRAWER_ROW_HEIGHT +
    Math.max(contentRowCount - 1, 0) * SPACING.sm;
  const initialHeight = Math.min(
    Math.max(Math.min(STATUS_DRAWER_HEIGHT, maxHeight), contentHeight),
    maxHeight
  );

  return maxHeight - initialHeight > STATUS_DRAWER_ROW_HEIGHT
    ? [initialHeight, maxHeight]
    : [initialHeight];
}
