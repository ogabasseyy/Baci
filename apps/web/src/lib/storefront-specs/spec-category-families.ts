import { getAccessoryKeySpecCategoryProjection } from './accessory-key-spec-category-projection';
import { getCameraKeySpecCategoryProjection } from './camera-key-spec-category-projection';
import { isNetworkDeviceCategory } from './is-network-device-category';
import { getNetworkDeviceKeySpecCategoryProjection } from './network-device-key-spec-category-projection';
import { getKeySpecCategoryProjection } from './spec-category-family-projections';
import {
  isAccessoryLikeCategory,
  type ProductSpecFamily,
  type SpecCategory,
} from './spec-taxonomy';

export function getKeySpecCategoriesForFamily(
  family: ProductSpecFamily,
  categoryName?: string
): SpecCategory[] {
  const normalizedCategoryName = categoryName?.trim();

  if (family === 'general') {
    if (!normalizedCategoryName) {
      return [];
    }

    if (isAccessoryLikeCategory(normalizedCategoryName.toLowerCase())) {
      return getAccessoryKeySpecCategoryProjection();
    }

    if (isNetworkDeviceCategory(normalizedCategoryName.toLowerCase())) {
      return getNetworkDeviceKeySpecCategoryProjection();
    }

    return getKeySpecCategoryProjection('general-supported');
  }

  if (family === 'camera') {
    return getCameraKeySpecCategoryProjection(normalizedCategoryName);
  }

  return getKeySpecCategoryProjection(family);
}
