import { isAccessoryLikeCategory } from './spec-accessory-classifier';
import { isCameraLikeCategory } from './spec-camera-classifier';

export type ProductSpecFamily = 'mobile' | 'computer' | 'camera' | 'general';

export function getProductSpecFamily(
  categoryName: string | null | undefined
): ProductSpecFamily {
  const normalized = (categoryName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
  const isAccessory = isAccessoryLikeCategory(normalized);

  // Camera families intentionally take precedence over the generic accessory
  // guard. Camera accessories, lenses, drones, and gimbals still need the
  // camera-safe projection rather than mobile/general device fields.
  if (isCameraLikeCategory(normalized)) {
    return 'camera';
  }

  if (
    !isAccessory &&
    (/(^|[^a-z])(cell|fitness tracker|iphone|ipad|phone|smartphone|tablet|smartwatch|wearable|watch|pad)(s)?([^a-z]|$)/.test(
      normalized
    ) ||
      normalized.includes('google pixel'))
  ) {
    return 'mobile';
  }

  if (
    !isAccessory &&
    /(^|[^a-z])(laptop|desktop|computer|notebook|macbook|pcs|pc)(s)?([^a-z]|$)/.test(
      normalized
    )
  ) {
    return 'computer';
  }

  return 'general';
}
