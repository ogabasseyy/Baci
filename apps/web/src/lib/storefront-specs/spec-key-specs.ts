import { getProductSchemaSpecValueDecision } from '../product-schema-spec-value-policy';
import { getKeySpecCategoriesForFamily } from './spec-category-families';
import type { ProductSpecSection } from './spec-data';
import type {
  ComparableProductKeySpecs,
  ProductSpecFamily,
} from './spec-taxonomy';

export function buildDetailedSpecsFromKeySpecs(
  keySpecs: ComparableProductKeySpecs,
  family: ProductSpecFamily,
  categoryName?: string
): ProductSpecSection[] {
  return getKeySpecCategoriesForFamily(family, categoryName)
    .map(({ category, fields }) => ({
      category,
      items: fields
        .filter(({ key, condition }) => {
          const value = keySpecs[key];
          return (
            value !== null &&
            value !== undefined &&
            (typeof value !== 'string' || value.trim().length > 0) &&
            getProductSchemaSpecValueDecision({
              canonicalSpecKey: key,
              hasCategory: family !== 'general' || Boolean(categoryName),
              isExplicitSpecKey: true,
              isMobileCategory: family === 'mobile',
              isPhoneOnlyLabel: false,
              productFamily: family,
              value,
            }) !== 'exclude' &&
            (!condition || condition(keySpecs))
          );
        })
        .map((field) => {
          const value = keySpecs[field.key];
          return {
            label: field.dynamicLabel
              ? field.dynamicLabel(keySpecs)
              : field.label,
            value: field.transform
              ? field.transform(value, keySpecs)
              : String(value),
          };
        }),
    }))
    .filter((section) => section.items.length > 0);
}
