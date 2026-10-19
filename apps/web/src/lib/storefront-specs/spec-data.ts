import { shouldIncludeProductSchemaSpec } from '@/lib/product-schema-specs';
import { resolveSupportedStorefrontProductCategoryRelation } from '@/lib/storefront-product-category-name';
import { buildDescriptionKeySpecs } from './build-description-key-specs';
import { dedupeSpecItems } from './dedupe-spec-items';
import { mergeSpecSections } from './merge-spec-sections';
import { normalizeSpecItems } from './normalize-spec-items';
import { normalizeSpecSections } from './normalize-spec-sections';
import { resolveSpecDataCategoryClassification } from './resolve-spec-data-category-classification';
import { buildDetailedSpecsFromKeySpecs } from './spec-key-specs';
import {
  type ComparableProductKeySpecs,
  getProductSpecFamily,
  SUMMARY_SPEC_PRIORITIES,
} from './spec-taxonomy';
import { normalizeSpecValueText } from './spec-value-normalization';
import type { VariantAttributeSource } from './variant-attributes';
import { normalizeVariantAttributes } from './variant-attributes';

export const MAX_SUMMARY_SPECS = 8;
const CAMERA_MOBILE_ONLY_SECTION_NAMES = new Set(['selfie camera']);

export interface ProductSpecItem {
  label: string;
  value: string;
}

export interface ProductSpecSection {
  category: string;
  items: ProductSpecItem[];
}

interface SpecDataSource {
  brand?: string | null;
  categories?:
    | { name?: string | null; slug?: string | null }
    | Array<{ name?: string | null; slug?: string | null }>
    | null;
  category?: string | null;
  category_slug?: string | null;
  condition?: string | null;
  description?: string | null;
  detailedSpecs?: ProductSpecSection[] | null;
  displaySize?: string | null;
  product_key_specs?: ComparableProductKeySpecs | null;
  ram?: string | null;
  specs?: ProductSpecItem[] | string | null;
  specifications?: ProductSpecSection[] | null;
  storage?: string | string[] | null;
  variant_attributes?: VariantAttributeSource;
}

function resolveSourceCategory(source: SpecDataSource) {
  return resolveSpecDataCategoryClassification(source);
}

function getVariantValue(
  variantAttributes: SpecDataSource['variant_attributes'],
  key: string
) {
  return normalizeVariantAttributes(variantAttributes)[key];
}

function getFirstSupportedFallbackValue(...values: unknown[]) {
  const [item] = dedupeSpecItems(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => ({
        label: 'Fallback value',
        value: normalizeSpecValueText(value),
      })),
    { omitUnsupportedValues: true }
  );

  return item?.value;
}

function resolveSchemaCategoryRelation(
  source: Pick<SpecDataSource, 'categories' | 'category' | 'category_slug'>
) {
  return Array.isArray(source.categories)
    ? resolveSupportedStorefrontProductCategoryRelation(source.categories)
    : source.categories;
}

function filterPdpSpecItems(
  items: ProductSpecItem[],
  section: string,
  source: Pick<SpecDataSource, 'categories' | 'category' | 'category_slug'>,
  productKeySpecs: ComparableProductKeySpecs | null | undefined
) {
  return items.filter((item) =>
    shouldIncludeProductSchemaSpec(
      {
        category: source.category,
        categories: resolveSchemaCategoryRelation(source),
        category_slug: source.category_slug,
        product_key_specs: productKeySpecs ?? undefined,
      },
      { label: item.label, section, value: item.value }
    )
  );
}

function filterPdpLegacySpecifications(
  sections: ProductSpecSection[],
  source: Pick<SpecDataSource, 'categories' | 'category' | 'category_slug'>,
  classificationName: string,
  productKeySpecs: ComparableProductKeySpecs | null | undefined
) {
  return sections.flatMap((section) => {
    const normalizedSectionName = section.category
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');
    if (
      getProductSpecFamily(classificationName) === 'camera' &&
      CAMERA_MOBILE_ONLY_SECTION_NAMES.has(normalizedSectionName)
    ) {
      return [];
    }

    const items = filterPdpSpecItems(
      section.items,
      section.category,
      source,
      productKeySpecs
    );

    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

function buildGeneralFallbackSpecs(
  source: SpecDataSource,
  categoryName: string,
  classificationName: string
): ProductSpecSection[] {
  const storageValue = getFirstSupportedFallbackValue(
    source.storage,
    getVariantValue(source.variant_attributes, 'storage')
  );
  const ramValue = getFirstSupportedFallbackValue(
    source.ram,
    getVariantValue(source.variant_attributes, 'ram')
  );
  const simValue = getFirstSupportedFallbackValue(
    getVariantValue(source.variant_attributes, 'sim_type')
  );
  const displayValue = getFirstSupportedFallbackValue(source.displaySize);
  const items = dedupeSpecItems(
    [
      {
        label: 'Brand',
        value:
          getFirstSupportedFallbackValue(source.brand, 'Generic') || 'Generic',
      },
      {
        label: 'Condition',
        value: getFirstSupportedFallbackValue(source.condition, 'New') || 'New',
      },
      {
        label: 'Category',
        value:
          getFirstSupportedFallbackValue(categoryName, 'General') || 'General',
      },
      ...(displayValue ? [{ label: 'Display', value: displayValue }] : []),
      ...(ramValue ? [{ label: 'RAM', value: ramValue }] : []),
      ...(storageValue ? [{ label: 'Storage', value: storageValue }] : []),
      ...(simValue ? [{ label: 'SIM', value: simValue }] : []),
    ],
    { omitUnsupportedValues: true }
  );

  return filterPdpLegacySpecifications(
    [{ category: 'General', items }],
    source,
    classificationName,
    source.product_key_specs
  );
}

function buildSummarySpecsFromSections(
  detailedSpecs: ProductSpecSection[]
): ProductSpecItem[] {
  const items: ProductSpecItem[] = [];

  for (const { label, candidates } of SUMMARY_SPEC_PRIORITIES) {
    for (const [categoryName, itemLabel] of candidates) {
      const section = detailedSpecs.find(
        (entry) => entry.category === categoryName
      );
      const item = section?.items.find((entry) => entry.label === itemLabel);
      if (item?.value) {
        items.push({ label, value: item.value });
        break;
      }
    }
  }

  return items;
}

export function buildProductSpecData(source: SpecDataSource) {
  const descriptionKeySpecs = buildDescriptionKeySpecs(source.description);
  const normalizedDetailedSpecs = normalizeSpecSections(source.detailedSpecs);
  const normalizedLegacySpecifications = normalizeSpecSections(
    source.specifications
  );
  const {
    hasCategory: hasSourceCategory,
    name: sourceCategoryName,
    classificationName: sourceClassificationName,
  } = resolveSourceCategory(source);
  // Unknown categories fail closed instead of inheriting the phone taxonomy.
  // This prevents a missing category join from turning camera or accessory
  // rows into phone-shaped PDP content.
  const specFamily = hasSourceCategory
    ? getProductSpecFamily(sourceClassificationName)
    : 'general';
  const keySpecSections =
    source.product_key_specs &&
    typeof source.product_key_specs === 'object' &&
    !Array.isArray(source.product_key_specs)
      ? buildDetailedSpecsFromKeySpecs(
          source.product_key_specs,
          specFamily,
          hasSourceCategory ? sourceCategoryName : undefined
        )
      : [];

  const detailedSpecifications = filterPdpLegacySpecifications(
    normalizedDetailedSpecs,
    source,
    sourceClassificationName,
    source.product_key_specs
  );
  const legacySpecifications = filterPdpLegacySpecifications(
    normalizedLegacySpecifications,
    source,
    sourceClassificationName,
    source.product_key_specs
  );
  const descriptionSpecifications = filterPdpLegacySpecifications(
    descriptionKeySpecs,
    source,
    sourceClassificationName,
    source.product_key_specs
  );

  const storedSpecifications = mergeSpecSections(
    detailedSpecifications,
    legacySpecifications
  );
  const usesGeneralFallback =
    storedSpecifications.length === 0 && keySpecSections.length === 0;
  const structuredSpecs =
    storedSpecifications.length > 0
      ? mergeSpecSections(storedSpecifications, keySpecSections)
      : keySpecSections.length > 0
        ? keySpecSections
        : buildGeneralFallbackSpecs(
            source,
            sourceCategoryName,
            sourceClassificationName
          );

  const detailedSpecs = usesGeneralFallback
    ? mergeSpecSections(descriptionSpecifications, structuredSpecs)
    : mergeSpecSections(structuredSpecs, descriptionSpecifications);
  const normalizedSummarySpecs = normalizeSpecItems(source.specs);
  const summarySpecifications = filterPdpSpecItems(
    normalizedSummarySpecs,
    'General',
    source,
    source.product_key_specs
  );

  const specs = dedupeSpecItems([
    ...summarySpecifications,
    ...buildSummarySpecsFromSections(detailedSpecs),
  ]).slice(0, MAX_SUMMARY_SPECS);

  return {
    detailedSpecs,
    specs,
  };
}
