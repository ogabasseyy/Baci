import { isAccessoryLikeCategory } from './spec-accessory-classifier';

const CAMERA_BODY_CATEGORY_NAMES = new Set([
  'camera',
  'cameras',
  'action cameras',
  'instant cameras',
  'camcorder',
  'camcorders',
  'dash cam',
  'dash cams',
  'drones',
  'gimbals',
]);

const MOBILE_CATEGORY_PATTERN =
  /(^|[^a-z])(cell|iphone|ipad|phone|smartphone|tablet|smartwatch|wearable|watch)(s)?([^a-z]|$)/;

export function isCameraLikeCategory(categoryName: string) {
  const normalized = categoryName
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');

  const isMobileCategory =
    MOBILE_CATEGORY_PATTERN.test(normalized) ||
    normalized.includes('google pixel');

  return (
    !isMobileCategory &&
    !isAccessoryLikeCategory(normalized) &&
    (CAMERA_BODY_CATEGORY_NAMES.has(normalized) ||
      /\bcameras?\b/.test(normalized) ||
      normalized.endsWith(' camera') ||
      normalized.endsWith(' cameras'))
  );
}
