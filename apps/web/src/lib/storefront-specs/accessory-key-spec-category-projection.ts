import { getGeneralKeySpecCategoryProjection } from './general-key-spec-category-projection';

const ACCESSORY_SPEC_CATEGORY_NAMES = new Set([
  'Body',
  'Connectivity',
  'Misc',
  'Power',
]);

export function getAccessoryKeySpecCategoryProjection() {
  return getGeneralKeySpecCategoryProjection().filter((category) =>
    ACCESSORY_SPEC_CATEGORY_NAMES.has(category.category)
  );
}
